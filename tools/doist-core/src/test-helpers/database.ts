import { DatabaseSync } from "node:sqlite";
import { Database } from "../db.ts";

export function openDb() {
	return new Database(
		{
			dbPath: ":memory:",
			rcPath: "/tmp/.doistrc",
		},
		(path) => new DatabaseSync(path),
	);
}
