import {
	Kysely,
	sql,
	type Expression,
	type ExpressionBuilder,
	type Insertable,
	type Selectable,
	type SqlBool,
} from "kysely";
import { jsonArrayFrom } from "kysely/helpers/sqlite";
import { SyncSqliteDatabase } from "sqlite-kysely";
import { driverFactory, type SqliteDriver } from "sqlite-runtime";
import type { ConfigPaths } from "./paths.ts";
import {
	normalizeFilter,
	normalizeLabel,
	normalizeNote,
	normalizeProject,
	normalizeSection,
	normalizeTask,
	type AppFilter,
	type AppLabel,
	type AppNote,
	type AppProject,
	type AppSection,
	type AppTask,
} from "./schema.ts";

/**
 * Opens a SQLite database against a host runtime's native module.
 *
 * The SQLite runtime selects the native driver for the current host.
 */
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

interface FilterTable {
	id: string;
	name: string;
	query: string;
	color: string | null;
	item_order: number;
	is_favorite: number;
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
	is_recurring: number;
	labels: string | null;
	is_completed: number;
	created_at: string | null;
	synced_at: string;
}

interface NoteTable {
	id: string;
	item_id: string;
	content: string;
	posted_at: string | null;
	is_deleted: number;
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
	filters: FilterTable;
	tasks: TaskTable;
	notes: NoteTable;
	meta: MetaTable;
};

export type DbProject = Selectable<ProjectTable>;
export type DbSection = Selectable<SectionTable>;
export type DbLabel = Selectable<LabelTable>;
export type DbFilter = Selectable<FilterTable>;
export type DbTask = Selectable<TaskTable>;
export type DbNote = Selectable<NoteTable>;

export type AppTaskWithNotes = AppTask & { notes: AppNote[] };

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

  CREATE TABLE IF NOT EXISTS filters (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	query       TEXT NOT NULL,
	color       TEXT,
	item_order  INTEGER DEFAULT 0,
	is_favorite INTEGER DEFAULT 0,
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
	is_recurring  INTEGER DEFAULT 0,
	labels        TEXT,
	is_completed  INTEGER DEFAULT 0,
	created_at    TEXT,
	synced_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
	id         TEXT PRIMARY KEY,
	item_id    TEXT NOT NULL,
	content    TEXT NOT NULL,
	posted_at  TEXT,
	is_deleted INTEGER DEFAULT 0,
	synced_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS notes_item_id_idx ON notes (item_id);
`;

export type TaskCriteria = {
	id?: string;
	content?: string;
	completed?: "any" | "completed" | "incomplete";
	projectId?: string | string[];
	parentId?: string | null;
	priority?: number;
	label?: string;
	due?: "today" | "overdue";
	limit?: number;
	offset?: number;
	orderBy?: {
		field: "created_at" | "updated_at" | "due_date" | "priority";
		direction: "asc" | "desc";
	};
};

// Expression builder helpers for the shared task-read criteria.
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
	isCompleted: boolean,
): Expression<SqlBool> {
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

function buildTaskFilters(
	eb: ExpressionBuilder<Schema, "tasks">,
	criteria: TaskCriteria | undefined,
): Expression<SqlBool>[] {
	const filters: Expression<SqlBool>[] = [];
	if (criteria?.id) {
		filters.push(eb("id", "=", criteria.id));
	}
	const content = buildContentFilter(eb, criteria?.content);
	if (content) {
		filters.push(content);
	}

	if (criteria?.completed === "completed") {
		filters.push(buildCompletedFilter(eb, true));
	} else if (criteria?.completed !== "any") {
		filters.push(buildCompletedFilter(eb, false));
	}

	const project = buildProjectIdFilter(eb, criteria?.projectId);
	if (project) {
		filters.push(project);
	}

	if (criteria?.parentId !== undefined) {
		filters.push(
			criteria.parentId === null
				? eb("parent_id", "is", null)
				: eb("parent_id", "=", criteria.parentId),
		);
	}

	if (criteria?.priority !== undefined) {
		filters.push(buildPriorityFilter(eb, criteria.priority));
	}
	if (criteria?.due) {
		filters.push(buildDueDateFilter(eb, criteria.due));
	}
	if (criteria?.label) {
		filters.push(buildLabelFilter(criteria.label));
	}

	return filters;
}

function parseNestedNotes(value: unknown): AppNote[] {
	const rows: unknown = typeof value === "string" ? JSON.parse(value) : value;
	if (!Array.isArray(rows)) {
		return [];
	}
	return rows.map((row) => {
		const note = row as {
			id: string;
			item_id: string;
			content: string;
			posted_at: string | null;
		};
		return {
			id: note.id,
			itemId: note.item_id,
			content: note.content,
			postedAt: note.posted_at,
		};
	});
}

export class Database {
	readonly #raw: SqliteDriver;
	readonly #query: Kysely<Schema>;
	readonly #sync: SyncSqliteDatabase<Schema>;

	constructor({ dbPath }: ConfigPaths) {
		this.#raw = driverFactory(dbPath);

		this.#raw.exec(SCHEMA_SQL);

		this.#sync = new SyncSqliteDatabase({ driver: this.#raw });
		this.#query = this.#sync.query;
	}

	close() {
		this.#sync.close();
	}

	transaction<T>(fn: () => T): T {
		return this.#sync.transaction(fn);
	}

	private projects() {
		return this.#query.selectFrom("projects").selectAll();
	}

	private tasks() {
		return this.#query.selectFrom("tasks").selectAll();
	}

	private notes() {
		return this.#query.selectFrom("notes").selectAll();
	}

	getTaskById(id: string): AppTask | null {
		const task = this.#sync.get(this.tasks().where("id", "=", id).compile());
		return task ? normalizeTask(task) : null;
	}

	selectTasks(criteria?: TaskCriteria): AppTask[] {
		let query = this.tasks();
		query = query.where((eb) => {
			const filters = buildTaskFilters(eb, criteria);
			return filters.length > 0 ? eb.and(filters) : eb.lit(true);
		});

		if (criteria?.orderBy) {
			query = query.orderBy(criteria.orderBy.field, criteria.orderBy.direction);
		}
		if (criteria?.limit !== undefined) {
			query = query.limit(
				criteria.limit === -1 ? -1 : Math.max(1, criteria.limit),
			);
		}
		if (criteria?.offset !== undefined) {
			if (criteria.limit === undefined) {
				query = query.limit(-1);
			}
			query = query.offset(criteria.offset);
		}

		return this.#sync.all(query.compile()).map(normalizeTask);
	}

	getProjectById(id: string): AppProject | null {
		const project = this.#sync.get(
			this.projects().where("id", "=", id).compile(),
		);
		return project ? normalizeProject(project) : null;
	}

	selectProjects(criteria?: {
		id?: string;
		isInbox?: boolean;
		name?: string | { value: string; match: "exact" | "like" };
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
				const { name } = criteria;
				if (typeof name === "string") {
					return eb("name", "=", name);
				}
				return name.match === "like"
					? eb("name", "like", `%${name.value}%`)
					: eb("name", "=", name.value);
			}

			return eb.lit(true);
		});

		query = query.orderBy("name");

		return this.#sync.all(query.compile()).map(normalizeProject);
	}

	// Section queries
	selectSections(projectId?: string): AppSection[] {
		let query = this.#query.selectFrom("sections").selectAll();

		if (projectId) {
			query = query.where("project_id", "=", projectId);
			query = query.orderBy("section_order");
		} else {
			query = query.orderBy("project_id");
			query = query.orderBy("section_order");
		}

		return this.#sync.all(query.compile()).map(normalizeSection);
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
		return this.#sync
			.all(
				this.#query.selectFrom("labels").selectAll().orderBy("name").compile(),
			)
			.map(normalizeLabel);
	}

	/**
	 * Read tasks and their non-deleted notes in one SQL query. The nested
	 * relation is deliberately owned by Database so callers cannot regress to
	 * one task query plus one notes query per read.
	 */
	selectTasksWithNotes(criteria?: TaskCriteria): AppTaskWithNotes[] {
		let query = this.#query
			.selectFrom("tasks")
			.selectAll("tasks")
			.select((eb) => [
				jsonArrayFrom(
					eb
						.selectFrom("notes")
						.select(["id", "item_id", "content", "posted_at"])
						.whereRef("notes.item_id", "=", "tasks.id")
						.where("is_deleted", "=", 0)
						.orderBy("posted_at", "asc"),
				).as("notes"),
			]);

		query = query.where((eb) => {
			const filters = buildTaskFilters(eb, criteria);
			return filters.length > 0 ? eb.and(filters) : eb.lit(true);
		});
		if (criteria?.limit !== undefined) {
			query = query.limit(criteria.limit);
		}

		return this.#sync.all(query.compile()).map((row) => ({
			...normalizeTask(row),
			notes: parseNestedNotes(row.notes),
		}));
	}

	getTaskWithNotes(id: string): AppTaskWithNotes | null {
		return this.selectTasksWithNotes({ completed: "any", id })[0] ?? null;
	}

	// Note queries
	selectNotesByTask(itemId: string): AppNote[] {
		return this.#sync
			.all(
				this.notes()
					.where("item_id", "=", itemId)
					.where("is_deleted", "=", 0)
					.orderBy("posted_at", "asc")
					.compile(),
			)
			.map(normalizeNote);
	}

	// Filter queries
	private filters() {
		return this.#query.selectFrom("filters").selectAll();
	}

	selectFilters(): AppFilter[] {
		return this.#sync
			.all(this.filters().orderBy("item_order").compile())
			.map(normalizeFilter);
	}

	getFilterById(id: string): AppFilter | null {
		const filter = this.#sync.get(
			this.filters().where("id", "=", id).compile(),
		);
		return filter ? normalizeFilter(filter) : null;
	}

	getFilterByName(name: string): AppFilter | null {
		const filter = this.#sync.get(
			this.filters().where("name", "=", name).compile(),
		);
		return filter ? normalizeFilter(filter) : null;
	}

	// Write operations
	private upsert<T extends keyof Schema>(
		table: T,
		column: keyof Schema[T] & string,
		values: Insertable<Schema[T]>,
	): void {
		const compiled = this.#query
			.insertInto(table)
			.values(values)
			.onConflict((oc) => oc.column(column).doUpdateSet(values))
			.compile();

		this.#sync.run(compiled);
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

	upsertFilter(filter: Insertable<FilterTable>): void {
		this.upsert("filters", "id", filter);
	}

	deleteFilterById(id: string): void {
		this.#sync.run(
			this.#query.deleteFrom("filters").where("id", "=", id).compile(),
		);
	}

	upsertTask(task: Insertable<TaskTable>): void {
		this.upsert("tasks", "id", task);
	}

	upsertNote(note: Insertable<NoteTable>): void {
		this.upsert("notes", "id", note);
	}

	updateTasksAsCompleted(ids: string[]): void {
		if (ids.length === 0) {
			return;
		}
		const now = new Date().toISOString();
		this.#sync.run(
			this.#query
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
		this.#sync.run(
			this.#query
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
		this.#sync.run(
			this.#query.deleteFrom("tasks").where("id", "in", ids).compile(),
		);
	}

	deleteNotesByIds(ids: string[]): void {
		if (ids.length === 0) {
			return;
		}
		this.#sync.run(
			this.#query.deleteFrom("notes").where("id", "in", ids).compile(),
		);
	}

	// Metadata operations
	getMeta(key: string): string | null {
		const row = this.#sync.get(
			this.#query
				.selectFrom("meta")
				.select("value")
				.where("key", "=", key)
				.compile(),
		);
		return row?.value ?? null;
	}

	setMeta(key: string, value: string): void {
		this.#sync.run(
			this.#query
				.insertInto("meta")
				.values({ key, value })
				.onConflict((oc) => oc.column("key").doUpdateSet({ value }))
				.compile(),
		);
	}

	deleteMeta(key: string): void {
		this.#sync.run(
			this.#query.deleteFrom("meta").where("key", "=", key).compile(),
		);
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
