import { Database } from "../db.ts";

export function openDb() {
	return new Database({
		dbPath: ":memory:",
		rcPath: "/tmp/.doistrc",
	});
}
