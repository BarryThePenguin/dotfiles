import type { SyncDb, DbSection } from "../db.ts";

export function listSections(db: SyncDb, projectId?: string): DbSection[] {
	if (projectId) {
		return db.all(
			db.q
				.selectFrom("sections")
				.selectAll()
				.where("project_id", "=", projectId)
				.orderBy("order_")
				.compile(),
		);
	}
	return db.all(
		db.q
			.selectFrom("sections")
			.selectAll()
			.orderBy("project_id")
			.orderBy("order_")
			.compile(),
	);
}
