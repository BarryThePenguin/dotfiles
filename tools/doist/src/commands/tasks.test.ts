import { describe, it, expect, beforeEach } from "vitest";
import { openDb, SyncDb, upsertProject, upsertTask } from "../db.ts";
import { listTasks, getTask, mergeLabelAdd, mergeLabelRemove, formatTask, searchTasks } from "./tasks.ts";

const NOW = new Date().toISOString();
const TODAY = new Date().toISOString().slice(0, 10);

const PROJECT = {
	id: "p1",
	name: "Work",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

const TASK_A = {
	id: "t1",
	project_id: "p1",
	section_id: null,
	content: "Alpha task",
	description: null,
	priority: 1,
	due_date: TODAY,
	due_string: "today",
	labels: JSON.stringify([]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

const TASK_B = {
	id: "t2",
	project_id: "p1",
	section_id: null,
	content: "Beta task",
	description: null,
	priority: 4,
	due_date: "2030-01-01",
	due_string: "Jan 1 2030",
	labels: JSON.stringify(["urgent"]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

const TASK_OVERDUE = {
	id: "t4",
	project_id: "p1",
	section_id: null,
	content: "Overdue task",
	description: null,
	priority: 2,
	due_date: "2020-01-01",
	due_string: "Jan 1 2020",
	labels: JSON.stringify([]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

const TASK_DONE = {
	id: "t3",
	project_id: "p1",
	section_id: null,
	content: "Done task",
	description: null,
	priority: 1,
	due_date: null,
	due_string: null,
	labels: JSON.stringify([]),
	is_completed: 1,
	created_at: NOW,
	synced_at: NOW,
};

describe("listTasks", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
		upsertProject(db, PROJECT);
		upsertTask(db, TASK_A);
		upsertTask(db, TASK_B);
		upsertTask(db, TASK_OVERDUE);
		upsertTask(db, TASK_DONE);
	});

	it("returns only incomplete tasks by default", () => {
		const results = listTasks(db, {});
		expect(results).toHaveLength(3);
		expect(results.map((t) => t.id)).toEqual(
			expect.arrayContaining(["t1", "t2"]),
		);
	});

	it("filters by project id", () => {
		const results = listTasks(db, { project: "p1" });
		expect(results).toHaveLength(3);
	});

	it("returns empty array for unknown project", () => {
		const results = listTasks(db, { project: "p999" });
		expect(results).toHaveLength(0);
	});

	it("filters by due=today", () => {
		const results = listTasks(db, { due: "today" });
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("t1");
	});

	it("filters by label", () => {
		const results = listTasks(db, { label: "urgent" });
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("t2");
	});

	it("returns empty array for unknown label", () => {
		const results = listTasks(db, { label: "nonexistent" });
		expect(results).toHaveLength(0);
	});

	it("does not partial-match label names", () => {
		const results = listTasks(db, { label: "urg" });
		expect(results).toHaveLength(0);
	});

	it("filters by due=overdue", () => {
		const results = listTasks(db, { due: "overdue" });
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("t4");
	});

	it("limits results", () => {
		const results = listTasks(db, { limit: 2 });
		expect(results).toHaveLength(2);
	});

	it("offsets results", () => {
		const all = listTasks(db, {});
		const paged = listTasks(db, { offset: 1 });
		expect(paged).toHaveLength(all.length - 1);
		expect(paged[0]?.id).toBe(all[1]?.id);
	});

	it("filters by priority", () => {
		const results = listTasks(db, { priority: 4 });
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("t2");
	});
});

describe("mergeLabelAdd", () => {
	it("adds a label to an empty list", () => {
		expect(mergeLabelAdd(null, "work")).toEqual(["work"]);
	});

	it("adds a label to an existing list", () => {
		expect(mergeLabelAdd(JSON.stringify(["urgent"]), "work")).toEqual([
			"urgent",
			"work",
		]);
	});

	it("is idempotent when label already present", () => {
		expect(mergeLabelAdd(JSON.stringify(["work"]), "work")).toEqual(["work"]);
	});
});

describe("mergeLabelRemove", () => {
	it("removes an existing label", () => {
		expect(
			mergeLabelRemove(JSON.stringify(["urgent", "work"]), "urgent"),
		).toEqual(["work"]);
	});

	it("is a no-op for an absent label", () => {
		expect(mergeLabelRemove(JSON.stringify(["work"]), "urgent")).toEqual([
			"work",
		]);
	});

	it("returns empty array when removing the only label", () => {
		expect(mergeLabelRemove(JSON.stringify(["work"]), "work")).toEqual([]);
	});

	it("handles null stored value", () => {
		expect(mergeLabelRemove(null, "work")).toEqual([]);
	});
});

describe("formatTask", () => {
	it("parses a JSON label string into an array", () => {
		const task = { ...TASK_B };
		expect(formatTask(task).labels).toEqual(["urgent"]);
	});

	it("returns an empty array for an empty label list", () => {
		expect(formatTask({ ...TASK_A }).labels).toEqual([]);
	});

	it("returns an empty array for a null labels value", () => {
		expect(formatTask({ ...TASK_A, labels: null }).labels).toEqual([]);
	});

	it("preserves all other task fields unchanged", () => {
		const { labels: _, ...rest } = formatTask({ ...TASK_A });
		expect(rest).toMatchObject({ id: "t1", content: "Alpha task" });
	});
});

describe("searchTasks", () => {
	let db: ReturnType<typeof openDb>;
	beforeEach(() => {
		db = openDb(":memory:");
		upsertProject(db, PROJECT);
		upsertTask(db, TASK_A);
		upsertTask(db, TASK_B);
		upsertTask(db, TASK_DONE);
	});

	it("returns tasks whose content matches the query", () => {
		const results = searchTasks(db, "Alpha");
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("t1");
	});

	it("is case-insensitive", () => {
		expect(searchTasks(db, "alpha")).toHaveLength(1);
		expect(searchTasks(db, "ALPHA")).toHaveLength(1);
	});

	it("does partial matching", () => {
		expect(searchTasks(db, "task")).toHaveLength(2);
	});

	it("excludes completed tasks", () => {
		expect(searchTasks(db, "Done")).toHaveLength(0);
	});

	it("returns empty for no match", () => {
		expect(searchTasks(db, "zzznomatch")).toHaveLength(0);
	});
});

describe("getTask", () => {
	let db: SyncDb;
	beforeEach(() => {
		db = openDb(":memory:");
		upsertTask(db, TASK_A);
	});

	it("returns the task for a known id", () => {
		const result = getTask(db, "t1");
		expect(result).not.toBeNull();
		expect(result?.content).toBe("Alpha task");
	});

	it("returns null for an unknown id", () => {
		const result = getTask(db, "missing");
		expect(result).toBeNull();
	});
});
