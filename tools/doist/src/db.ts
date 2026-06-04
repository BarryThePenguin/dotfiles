import type { api } from "@opentelemetry/sdk-node";
import {
	ATTR_DB_OPERATION_NAME,
	ATTR_DB_QUERY_TEXT,
	ATTR_DB_SYSTEM_NAME,
} from "@opentelemetry/semantic-conventions";
import {
	CompiledQuery,
	DummyDriver,
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	sql,
	type Expression,
	type ExpressionBuilder,
	type Insertable,
	type Selectable,
	type SqlBool,
} from "kysely";
import {
	DatabaseSync,
	type SQLInputValue,
	type StatementSync,
} from "node:sqlite";
import type { ConfigPaths } from "./paths.ts";
import {
	normalizeLabel,
	normalizeProject,
	normalizeSection,
	normalizeTask,
	type AppLabel,
	type AppProject,
	type AppSection,
	type AppTask,
} from "./schema.ts";
import { SPAN_NAME_DB_QUERY, SPAN_NAME_DB_TRANSACTION } from "./semconv.ts";
import { tracer } from "./telemetry.ts";

interface ProjectTable {
	id: string;
	name: string;
	color: string | null;
	is_favorite: number;
	is_inbox: number;
	synced_at: string;
}

interface SectionTable {
	id: string;
	project_id: string;
	name: string;
	section_order: number | null;
	synced_at: string;
}

interface LabelTable {
	id: string;
	name: string;
	color: string | null;
	synced_at: string;
}

interface TaskTable {
	id: string;
	project_id: string | null;
	section_id: string | null;
	parent_id: string | null;
	child_order: number | null;
	note_count: number | null;
	updated_at: string | null;
	content: string;
	description: string | null;
	priority: number | null;
	due_date: string | null;
	due_string: string | null;
	labels: string | null;
	is_completed: number;
	created_at: string | null;
	synced_at: string;
}

interface MetaTable {
	key: string;
	value: string;
}

type Schema = {
	projects: ProjectTable;
	sections: SectionTable;
	labels: LabelTable;
	tasks: TaskTable;
	meta: MetaTable;
};

export type DbProject = Selectable<ProjectTable>;
export type DbSection = Selectable<SectionTable>;
export type DbLabel = Selectable<LabelTable>;
export type DbTask = Selectable<TaskTable>;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	color       TEXT,
	is_favorite INTEGER DEFAULT 0,
	is_inbox    INTEGER DEFAULT 0,
	synced_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sections (
	id         		TEXT PRIMARY KEY,
	project_id  	TEXT NOT NULL,
	name        	TEXT NOT NULL,
	section_order   INTEGER,
	synced_at   	TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS labels (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	color       TEXT,
	synced_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
	id            TEXT PRIMARY KEY,
	project_id    TEXT,
	section_id    TEXT,
	parent_id     TEXT,
	child_order   INTEGER,
	note_count    INTEGER,
	updated_at    TEXT,
	content       TEXT NOT NULL,
	description   TEXT,
	priority      INTEGER,
	due_date      TEXT,
	due_string    TEXT,
	labels        TEXT,
	is_completed  INTEGER DEFAULT 0,
	created_at    TEXT,
	synced_at     TEXT NOT NULL
  );
`;

// Expression builder helper for building reusable filter expressions
function buildProjectIdFilter(
	eb: ExpressionBuilder<Schema, "tasks">,
	projectId: string | string[] | undefined,
): Expression<SqlBool> | null {
	if (!projectId) {
		return null;
	}

	if (Array.isArray(projectId)) {
		return eb("project_id", "in", projectId);
	}
	return eb("project_id", "=", projectId);
}

function buildCompletedFilter(
	eb: ExpressionBuilder<Schema, "tasks">,
	isCompleted: boolean | undefined,
): Expression<SqlBool> | null {
	if (isCompleted === undefined) {
		return null;
	}
	return eb("is_completed", "=", isCompleted ? 1 : 0);
}

function buildContentFilter(
	eb: ExpressionBuilder<Schema, "tasks">,
	content: string | undefined,
): Expression<SqlBool> | null {
	if (!content) {
		return null;
	}
	return eb("content", "like", `%${content}%`);
}

function buildLabelFilter(label: string): Expression<SqlBool> {
	return sql<SqlBool>`EXISTS (SELECT 1 FROM json_each(labels) WHERE value = ${label})`;
}

function buildDueDateFilter(
	eb: ExpressionBuilder<Schema, "tasks">,
	due: "today" | "overdue",
): Expression<SqlBool> {
	const today = new Date().toISOString().slice(0, 10);
	if (due === "today") {
		return eb("due_date", "=", today);
	}
	return eb.and([eb("due_date", "is not", null), eb("due_date", "<", today)]);
}

function buildPriorityFilter(
	eb: ExpressionBuilder<Schema, "tasks">,
	priority: number,
): Expression<SqlBool> {
	return eb("priority", "=", priority);
}

export class Database {
	readonly #raw: DatabaseSync;
	readonly #stmts = new Map<string, StatementSync>();
	readonly #q: Kysely<Schema>;

	constructor({ dbPath }: ConfigPaths) {
		this.#raw = new DatabaseSync(dbPath);

		this.#raw.exec(SCHEMA_SQL);

		this.#q = new Kysely<Schema>({
			dialect: {
				createAdapter: () => new SqliteAdapter(),
				createDriver: () => new DummyDriver(),
				createIntrospector: (db) => new SqliteIntrospector(db),
				createQueryCompiler: () => new SqliteQueryCompiler(),
			},
		});
	}

	close() {
		this.#stmts.clear();
		this.#raw.close();
	}

	#prepare(sql: string): StatementSync {
		let stmt = this.#stmts.get(sql);
		if (!stmt) {
			stmt = this.#raw.prepare(sql);
			this.#stmts.set(sql, stmt);
		}
		return stmt;
	}

	#normalizeSql(sql: string) {
		return sql.trim().replace(/\s+/g, " ");
	}

	#getDbOperation(sql: string) {
		return (sql.trim().split(" ", 1)[0] ?? "query").toUpperCase();
	}

	#spanAttributes(query: CompiledQuery): api.Attributes {
		const sql = this.#normalizeSql(query.sql);
		const attributes: api.Attributes = {
			[ATTR_DB_SYSTEM_NAME]: "sqlite",
			[ATTR_DB_QUERY_TEXT]: sql,
			[ATTR_DB_OPERATION_NAME]: this.#getDbOperation(sql),
		};

		const parameters = query.parameters as unknown;
		if (Array.isArray(parameters)) {
			for (const [index, value] of parameters.entries()) {
				attributes[`db.query.parameter.${index}`] = String(value);
			}
		} else if (parameters && typeof parameters === "object") {
			for (const [key, value] of Object.entries(parameters)) {
				attributes[`db.query.parameter.${key}`] = String(value);
			}
		}

		return attributes;
	}

	all<R>(query: CompiledQuery<R>): R[] {
		return tracer.startActiveSpan(
			SPAN_NAME_DB_QUERY,
			{
				attributes: this.#spanAttributes(query),
			},
			(span) => {
				try {
					const parameters = query.parameters as ReadonlyArray<SQLInputValue>;
					return this.#prepare(query.sql).all(...parameters) as R[];
				} finally {
					span.end();
				}
			},
		);
	}

	get<R>(query: CompiledQuery<R>): R | undefined {
		return tracer.startActiveSpan(
			SPAN_NAME_DB_QUERY,
			{
				attributes: this.#spanAttributes(query),
			},
			(span) => {
				try {
					const parameters = query.parameters as ReadonlyArray<SQLInputValue>;
					return this.#prepare(query.sql).get(...parameters) as R | undefined;
				} finally {
					span.end();
				}
			},
		);
	}

	run(query: CompiledQuery): void {
		tracer.startActiveSpan(
			SPAN_NAME_DB_QUERY,
			{
				attributes: this.#spanAttributes(query),
			},
			(span) => {
				try {
					const parameters = query.parameters as ReadonlyArray<SQLInputValue>;
					return this.#prepare(query.sql).run(...parameters);
				} finally {
					span.end();
				}
			},
		);
	}

	transaction<T>(fn: () => T): T {
		return tracer.startActiveSpan(
			SPAN_NAME_DB_TRANSACTION,
			{
				attributes: {
					[ATTR_DB_SYSTEM_NAME]: "sqlite",
					[ATTR_DB_OPERATION_NAME]: "TRANSACTION",
				},
			},
			(span) => {
				this.#raw.exec("BEGIN");
				try {
					const result = fn();
					this.#raw.exec("COMMIT");
					return result;
				} catch (err) {
					this.#raw.exec("ROLLBACK");
					span.recordException(err as Error);
					throw err;
				} finally {
					span.end();
				}
			},
		);
	}

	private projects() {
		return this.#q.selectFrom("projects").selectAll();
	}

	private tasks() {
		return this.#q.selectFrom("tasks").selectAll();
	}

	getTaskById(id: string): AppTask | null {
		const task = this.get(this.tasks().where("id", "=", id).compile());
		return task ? normalizeTask(task) : null;
	}

	selectTasks(criteria?: {
		content?: string;
		completed?: "any" | "completed" | "incomplete";
		projectId?: string[] | string | undefined;
		priority?: number | undefined;
		label?: string;
		due?: "today" | "overdue";
		limit?: number;
		offset?: number;
		orderBy?: {
			field: "created_at" | "updated_at" | "due_date" | "priority";
			direction: "asc" | "desc";
		};
	}): AppTask[] {
		let query = this.tasks();

		// Build where clause using expression builder for type-safe filters
		query = query.where((eb) => {
			const filterExpressions: Expression<SqlBool>[] = [];

			// Content filter
			const contentFilter = buildContentFilter(eb, criteria?.content);
			if (contentFilter) {
				filterExpressions.push(contentFilter);
			}

			// Completion status filter
			if (criteria?.completed === "completed") {
				const completedFilter = buildCompletedFilter(eb, true);
				if (completedFilter) {
					filterExpressions.push(completedFilter);
				}
			} else if (criteria?.completed !== "any") {
				// Default to 'incomplete': exclude completed unless explicitly 'any'
				const completedFilter = buildCompletedFilter(eb, false);
				if (completedFilter) {
					filterExpressions.push(completedFilter);
				}
			}

			// Project filter
			if (criteria?.projectId) {
				const projectFilter = buildProjectIdFilter(eb, criteria.projectId);
				if (projectFilter) {
					filterExpressions.push(projectFilter);
				}
			}

			// Priority filter
			if (criteria?.priority !== undefined) {
				filterExpressions.push(buildPriorityFilter(eb, criteria.priority));
			}

			// Due date filter
			if (criteria?.due) {
				filterExpressions.push(buildDueDateFilter(eb, criteria.due));
			}

			// Label filter
			if (criteria?.label) {
				filterExpressions.push(buildLabelFilter(criteria.label));
			}

			return filterExpressions.length > 0
				? eb.and(filterExpressions)
				: eb.lit(true);
		});

		// Apply ordering
		if (criteria?.orderBy) {
			query = query.orderBy(criteria.orderBy.field, criteria.orderBy.direction);
		}

		// Apply pagination
		if (criteria?.limit !== undefined) {
			query = query.limit(
				criteria.limit === -1 ? -1 : Math.max(1, criteria.limit),
			);
		}

		if (criteria?.offset !== undefined) {
			// SQLite requires a LIMIT before OFFSET; use -1 for unlimited
			if (criteria.limit === undefined) {
				query = query.limit(-1);
			}
			query = query.offset(criteria.offset);
		}

		return this.all(query.compile()).map(normalizeTask);
	}

	getProjectById(id: string): AppProject | null {
		const project = this.get(this.projects().where("id", "=", id).compile());
		return project ? normalizeProject(project) : null;

	}

	selectProjects(criteria?: {
		id?: string;
		isInbox?: boolean;
		name?: string;
	}): AppProject[] {
		let query = this.projects();

		query = query.where((eb) => {
			if (criteria?.id) {
				return eb("id", "=", criteria.id);
			}

			if (criteria?.isInbox !== undefined) {
				return eb("is_inbox", "=", criteria.isInbox ? 1 : 0);
			}

			if (criteria?.name) {
				return eb("name", "like", `%${criteria.name}%`);
			}

			return eb.lit(true);
		});

		query = query.orderBy("name");

		return this.all(query.compile()).map(normalizeProject);
	}

	// Section queries
	selectSections(projectId?: string): AppSection[] {
		let query = this.#q.selectFrom("sections").selectAll();

		if (projectId) {
			query = query.where("project_id", "=", projectId);
			query = query.orderBy("section_order");
		} else {
			query = query.orderBy("project_id");
			query = query.orderBy("section_order");
		}

		return this.all(query.compile()).map(normalizeSection);
	}

	// Backward compatibility wrappers
	selectAllSections(): AppSection[] {
		return this.selectSections();
	}

	selectSectionsByProjectId(projectId: string): AppSection[] {
		return this.selectSections(projectId);
	}

	// Label queries
	selectAllLabels(): AppLabel[] {
		return this.all(
			this.#q.selectFrom("labels").selectAll().orderBy("name").compile(),
		).map(normalizeLabel);
	}

	// Write operations
	private upsert<T extends keyof Schema>(
		table: T,
		column: keyof Schema[T] & string,
		values: Insertable<Schema[T]>,
	): void {
		const compiled = this.#q
			.insertInto(table)
			.values(values)
			.onConflict((oc) => oc.column(column).doUpdateSet(values))
			.compile();

		this.run(compiled);
	}

	upsertProject(project: Insertable<ProjectTable>): void {
		this.upsert("projects", "id", project);
	}

	upsertSection(section: Insertable<SectionTable>): void {
		this.upsert("sections", "id", section);
	}

	upsertLabel(label: Insertable<LabelTable>): void {
		this.upsert("labels", "id", label);
	}

	upsertTask(task: Insertable<TaskTable>): void {
		this.upsert("tasks", "id", task);
	}

	updateTasksAsCompleted(ids: string[]): void {
		if (ids.length === 0) {
			return;
		}
		const now = new Date().toISOString();
		this.run(
			this.#q
				.updateTable("tasks")
				.set({ is_completed: 1, synced_at: now })
				.where("id", "in", ids)
				.compile(),
		);
	}

	updateTasksAsIncomplete(ids: string[]): void {
		if (ids.length === 0) {
			return;
		}
		const now = new Date().toISOString();
		this.run(
			this.#q
				.updateTable("tasks")
				.set({ is_completed: 0, synced_at: now })
				.where("id", "in", ids)
				.compile(),
		);
	}

	deleteTasksByIds(ids: string[]): void {
		if (ids.length === 0) {
			return;
		}
		this.run(this.#q.deleteFrom("tasks").where("id", "in", ids).compile());
	}

	// Metadata operations
	getMeta(key: string): string | null {
		const row = this.get(
			this.#q
				.selectFrom("meta")
				.select("value")
				.where("key", "=", key)
				.compile(),
		);
		return row?.value ?? null;
	}

	setMeta(key: string, value: string): void {
		this.run(
			this.#q
				.insertInto("meta")
				.values({ key, value })
				.onConflict((oc) => oc.column("key").doUpdateSet({ value }))
				.compile(),
		);
	}

	deleteMeta(key: string): void {
		this.run(this.#q.deleteFrom("meta").where("key", "=", key).compile());
	}

	// Backward compatibility wrappers
	getSyncToken(): string | null {
		return this.getMeta("sync_token");
	}

	setSyncToken(token: string): void {
		this.setMeta("sync_token", token);
	}

	resetSyncToken(): void {
		this.deleteMeta("sync_token");
	}

	getLastSyncedAt(): string | null {
		return this.getMeta("last_synced_at");
	}

	setLastSyncedAt(timestamp: string): void {
		this.setMeta("last_synced_at", timestamp);
	}
}
