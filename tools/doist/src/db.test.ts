import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "kysely";
import {
	openDb,
	upsertProject,
	upsertSection,
	upsertLabel,
	upsertTask,
	getSyncToken,
	setSyncToken,
	SyncDb,
} from "./db.ts";

const NOW = new Date().toISOString();

const PROJECT = {
	id: "p1",
	name: "Inbox",
	color: "blue",
	is_favorite: 0,
	is_inbox: 1,
	synced_at: NOW,
};

const SECTION = {
	id: "s1",
	project_id: "p1",
	name: "This Week",
	order_: 1,
	synced_at: NOW,
};

const LABEL = {
	id: "l1",
	name: "urgent",
	color: "red",
	synced_at: NOW,
};

const TASK = {
	id: "t1",
	project_id: "p1",
	section_id: "s1",
	content: "Write tests",
	description: "All the tests",
	priority: 4,
	due_date: "2026-05-10",
	due_string: "tomorrow",
	labels: JSON.stringify(["urgent"]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

describe("getSyncToken / setSyncToken", () => {
	it("returns null when no token has been saved", () => {
		const db = openDb(":memory:");
		expect(getSyncToken(db)).toBeNull();
	});

	it("round-trips a token", () => {
		const db = openDb(":memory:");
		setSyncToken(db, "abc123");
		expect(getSyncToken(db)).toBe("abc123");
	});

	it("overwrites the previous token", () => {
		const db = openDb(":memory:");
		setSyncToken(db, "first");
		setSyncToken(db, "second");
		expect(getSyncToken(db)).toBe("second");
	});
});

describe("openDb", () => {
	it("creates all four tables", () => {
		const db = openDb(":memory:");
		const names = db
			.all(sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`.compile(db.q))
			.map((r) => r.name);
		expect(names).toContain("projects");
		expect(names).toContain("sections");
		expect(names).toContain("labels");
		expect(names).toContain("tasks");
	});
});

describe("upsertProject", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
	});

	it("inserts a project", () => {
		upsertProject(db, PROJECT);
		const row = db.get(
			db.q.selectFrom("projects").selectAll().where("id", "=", "p1").compile(),
		);
		expect(row?.name).toBe("Inbox");
		expect(row?.is_inbox).toBe(1);
	});

	it("is idempotent — running twice yields one row with updated values", () => {
		upsertProject(db, PROJECT);
		upsertProject(db, { ...PROJECT, name: "Updated Inbox" });
		const rows = db.all(db.q.selectFrom("projects").selectAll().compile());
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Updated Inbox");
	});
});

describe("upsertSection", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
	});

	it("inserts a section", () => {
		upsertSection(db, SECTION);
		const row = db.get(
			db.q.selectFrom("sections").selectAll().where("id", "=", "s1").compile(),
		);
		expect(row?.name).toBe("This Week");
	});

	it("is idempotent", () => {
		upsertSection(db, SECTION);
		upsertSection(db, { ...SECTION, name: "Next Week" });
		const rows = db.all(db.q.selectFrom("sections").selectAll().compile());
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Next Week");
	});
});

describe("upsertLabel", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
	});

	it("inserts a label", () => {
		upsertLabel(db, LABEL);
		const row = db.get(
			db.q.selectFrom("labels").selectAll().where("id", "=", "l1").compile(),
		);
		expect(row?.name).toBe("urgent");
	});

	it("is idempotent", () => {
		upsertLabel(db, LABEL);
		upsertLabel(db, { ...LABEL, color: "orange" });
		const rows = db.all(db.q.selectFrom("labels").selectAll().compile());
		expect(rows).toHaveLength(1);
		expect(rows[0]?.color).toBe("orange");
	});
});

describe("upsertTask", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
	});

	it("inserts a task", () => {
		upsertTask(db, TASK);
		const row = db.get(
			db.q.selectFrom("tasks").selectAll().where("id", "=", "t1").compile(),
		);
		expect(row?.content).toBe("Write tests");
		expect(row?.priority).toBe(4);
	});

	it("is idempotent", () => {
		upsertTask(db, TASK);
		upsertTask(db, { ...TASK, content: "Write better tests" });
		const rows = db.all(db.q.selectFrom("tasks").selectAll().compile());
		expect(rows).toHaveLength(1);
		expect(rows[0]?.content).toBe("Write better tests");
	});

	it("stores labels as JSON string", () => {
		upsertTask(db, TASK);
		const row = db.get(
			db.q.selectFrom("tasks").select("labels").where("id", "=", "t1").compile(),
		);
		expect(row?.labels).toEqual(JSON.stringify(["urgent"]));
	});
});
