import { describe, it, expect, beforeEach } from "vitest";
import { openDb, SyncDb, upsertProject } from "../db.ts";
import { resolveProject } from "./projects.ts";

const NOW = new Date().toISOString();

const PROJECT_A = {
	id: "p1",
	name: "Work",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};
const PROJECT_B = {
	id: "p2",
	name: "Personal",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};
const PROJECT_DUP = {
	id: "p3",
	name: "Work",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

describe("resolveProject", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
		upsertProject(db, PROJECT_A);
		upsertProject(db, PROJECT_B);
	});

	it("resolves a known project name to its id", () => {
		expect(resolveProject(db, "Work")).toBe("p1");
	});

	it("returns the input as-is when no project name matches", () => {
		expect(resolveProject(db, "raw-id-xyz")).toBe("raw-id-xyz");
	});

	it("returns the input as-is when multiple projects share the name", () => {
		upsertProject(db, PROJECT_DUP);
		expect(resolveProject(db, "Work")).toBe("Work");
	});
});
