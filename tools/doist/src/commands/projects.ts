import type { SyncDb, DbProject } from "../db.ts";

export function listProjects(db: SyncDb): DbProject[] {
	return db.all(
		db.q.selectFrom("projects").selectAll().orderBy("name").compile(),
	);
}

export function resolveProject(db: SyncDb, nameOrId: string): string {
	const rows = db.all(
		db.q
			.selectFrom("projects")
			.select("id")
			.where("name", "=", nameOrId)
			.compile(),
	);
	const [firstRow] = rows;
	if (firstRow && rows.length === 1) {
		return firstRow.id;
	}
	return nameOrId;
}
