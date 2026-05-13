import { describe, it, expect, beforeEach } from "vitest";
import { openDb, SyncDb, upsertProject, upsertSection } from "../db.ts";
import { listSections } from "./sections.ts";

const NOW = new Date().toISOString();

const PROJECT_A = { id: "p1", name: "Work", color: null, is_favorite: 0, is_inbox: 0, synced_at: NOW };
const PROJECT_B = { id: "p2", name: "Personal", color: null, is_favorite: 0, is_inbox: 0, synced_at: NOW };

const SECTION_A1 = { id: "s1", project_id: "p1", name: "Backlog", order_: 2, synced_at: NOW };
const SECTION_A2 = { id: "s2", project_id: "p1", name: "In Progress", order_: 1, synced_at: NOW };
const SECTION_B1 = { id: "s3", project_id: "p2", name: "Someday", order_: 1, synced_at: NOW };

describe("listSections", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
		upsertProject(db, PROJECT_A);
		upsertProject(db, PROJECT_B);
		upsertSection(db, SECTION_A1);
		upsertSection(db, SECTION_A2);
		upsertSection(db, SECTION_B1);
	});

	it("returns all sections when no project filter given", () => {
		const results = listSections(db);
		expect(results).toHaveLength(3);
	});

	it("filters by project id", () => {
		const results = listSections(db, "p1");
		expect(results).toHaveLength(2);
		expect(results.every((s) => s.project_id === "p1")).toBe(true);
	});

	it("returns sections ordered by order_ within a project", () => {
		const results = listSections(db, "p1");
		expect(results[0]?.id).toBe("s2"); // order_ 1
		expect(results[1]?.id).toBe("s1"); // order_ 2
	});

	it("returns empty array for unknown project", () => {
		const results = listSections(db, "p999");
		expect(results).toHaveLength(0);
	});
});
