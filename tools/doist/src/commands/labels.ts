import type { SyncDb, DbLabel } from "../db.ts";

export function listLabels(db: SyncDb): DbLabel[] {
	return db.all(db.q.selectFrom("labels").selectAll().orderBy("name").compile());
}
