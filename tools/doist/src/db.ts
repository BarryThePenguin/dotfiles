import {
	CompiledQuery,
	DummyDriver,
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type Insertable,
	type Selectable,
} from "kysely";
import {
	DatabaseSync,
	type SQLInputValue,
	type StatementSync,
} from "node:sqlite";

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
	order_: number | null;
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

export class SyncDb implements Disposable {
	readonly #raw: DatabaseSync;
	readonly #stmts = new Map<string, StatementSync>();
	readonly q: Kysely<Schema>;

	constructor(path: string) {
		this.#raw = new DatabaseSync(path);
		this.#raw.exec(`
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
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        name        TEXT NOT NULL,
        order_      INTEGER,
        synced_at   TEXT NOT NULL
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
    `);
		this.q = new Kysely<Schema>({
			dialect: {
				createAdapter: () => new SqliteAdapter(),
				createDriver: () => new DummyDriver(),
				createIntrospector: (db) => new SqliteIntrospector(db),
				createQueryCompiler: () => new SqliteQueryCompiler(),
			},
		});
	}

	close(): void {
		this.#stmts.clear();
		this.#raw.close();
	}

	[Symbol.dispose](): void {
		this.close();
	}

	#prepare(sql: string): StatementSync {
		let stmt = this.#stmts.get(sql);
		if (!stmt) {
			stmt = this.#raw.prepare(sql);
			this.#stmts.set(sql, stmt);
		}
		return stmt;
	}

	all<R>(query: CompiledQuery<R>): R[] {
		const parameters = query.parameters as ReadonlyArray<SQLInputValue>;
		return this.#prepare(query.sql).all(...parameters) as R[];
	}

	get<R>(query: CompiledQuery<R>): R | undefined {
		const parameters = query.parameters as ReadonlyArray<SQLInputValue>;
		return this.#prepare(query.sql).get(...parameters) as R | undefined;
	}

	run(query: CompiledQuery): void {
		const parameters = query.parameters as ReadonlyArray<SQLInputValue>;
		this.#prepare(query.sql).run(...parameters);
	}

	transaction<T>(fn: () => T extends Promise<unknown> ? never : T): T {
		this.#raw.exec("BEGIN");
		try {
			const result = fn();
			this.#raw.exec("COMMIT");
			return result;
		} catch (e) {
			this.#raw.exec("ROLLBACK");
			throw e;
		}
	}
}

export function openDb(path: string): SyncDb {
	return new SyncDb(path);
}

export function resetSyncToken(db: SyncDb): void {
	db.run(db.q.deleteFrom("meta").where("key", "=", "sync_token").compile());
}

export function getSyncToken(db: SyncDb): string | null {
	const row = db.get(
		db.q
			.selectFrom("meta")
			.select("value")
			.where("key", "=", "sync_token")
			.compile(),
	);
	return row?.value ?? null;
}

export function setSyncToken(db: SyncDb, token: string): void {
	db.run(
		db.q
			.insertInto("meta")
			.values({ key: "sync_token", value: token })
			.onConflict((oc) => oc.column("key").doUpdateSet({ value: token }))
			.compile(),
	);
}

export function getLastSyncedAt(db: SyncDb): string | null {
	const row = db.get(
		db.q
			.selectFrom("meta")
			.select("value")
			.where("key", "=", "last_synced_at")
			.compile(),
	);
	return row?.value ?? null;
}

export function setLastSyncedAt(db: SyncDb, timestamp: string): void {
	db.run(
		db.q
			.insertInto("meta")
			.values({ key: "last_synced_at", value: timestamp })
			.onConflict((oc) => oc.column("key").doUpdateSet({ value: timestamp }))
			.compile(),
	);
}

export function upsertProject(
	db: SyncDb,
	project: Insertable<ProjectTable>,
): void {
	db.run(
		db.q
			.insertInto("projects")
			.values(project)
			.onConflict((oc) => oc.column("id").doUpdateSet(project))
			.compile(),
	);
}

export function upsertSection(
	db: SyncDb,
	section: Insertable<SectionTable>,
): void {
	db.run(
		db.q
			.insertInto("sections")
			.values(section)
			.onConflict((oc) => oc.column("id").doUpdateSet(section))
			.compile(),
	);
}

export function upsertLabel(db: SyncDb, label: Insertable<LabelTable>): void {
	db.run(
		db.q
			.insertInto("labels")
			.values(label)
			.onConflict((oc) => oc.column("id").doUpdateSet(label))
			.compile(),
	);
}

export function upsertTask(db: SyncDb, task: Insertable<TaskTable>): void {
	db.run(
		db.q
			.insertInto("tasks")
			.values(task)
			.onConflict((oc) => oc.column("id").doUpdateSet(task))
			.compile(),
	);
}
