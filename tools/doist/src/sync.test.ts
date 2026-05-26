import { describe, expect, it, vi } from "vitest";
import { filterToAllowedProjects } from "./filtering.ts";
import { syncAndPersist } from "./sync.ts";
import type { AllData, TodoistClient } from "./todoist.ts";
import { openDb } from "./test-helpers/database.ts";

const NOW = new Date().toISOString();

function makeProject(id: string, name: string) {
	return { id, name, color: null, is_favorite: 0, is_inbox: 0, synced_at: NOW };
}
function makeSection(id: string, projectId: string) {
	return { id, project_id: projectId, name: "S", order_: 0, synced_at: NOW };
}
function makeTask(id: string, projectId: string) {
	return {
		id,
		project_id: projectId,
		section_id: null,
		content: "T",
		description: null,
		priority: 1,
		due_date: null,
		due_string: null,
		labels: "[]",
		is_completed: 0,
		created_at: null,
		synced_at: NOW,
	};
}

function makeData(overrides: Partial<AllData> = {}): AllData {
	return {
		projects: [],
		sections: [],
		labels: [],
		tasks: [],
		completedTaskIds: [],
		deletedTaskIds: [],
		syncToken: "sync-token",
		...overrides,
	};
}

function makeMockClient(data: Partial<AllData> = {}): TodoistClient {
	return {
		sync: vi.fn().mockResolvedValue(makeData(data)),
		completeTask: vi.fn(),
		updateTask: vi.fn(),
		addTask: vi.fn(),
	};
}

describe("filterToAllowedProjects", () => {
	it("keeps only projects matching by name", () => {
		const data = makeData({
			projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
		});
		const result = filterToAllowedProjects(data, ["Work"]);
		expect(result.projects.map((p) => p.id)).toEqual(["p1"]);
	});

	it("keeps only projects matching by id", () => {
		const data = makeData({
			projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
		});
		const result = filterToAllowedProjects(data, ["p2"]);
		expect(result.projects.map((p) => p.id)).toEqual(["p2"]);
	});

	it("filters sections to allowed project ids", () => {
		const data = makeData({
			projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
			sections: [makeSection("s1", "p1"), makeSection("s2", "p2")],
		});
		const result = filterToAllowedProjects(data, ["Work"]);
		expect(result.sections.map((s) => s.id)).toEqual(["s1"]);
	});

	it("filters tasks to allowed project ids", () => {
		const data = makeData({
			projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
			tasks: [makeTask("t1", "p1"), makeTask("t2", "p2")],
		});
		const result = filterToAllowedProjects(data, ["Work"]);
		expect(result.tasks.map((t) => t.id)).toEqual(["t1"]);
	});

	it("keeps labels unfiltered (labels are global)", () => {
		const label = { id: "l1", name: "urgent", color: null, synced_at: NOW };
		const data = makeData({
			projects: [makeProject("p1", "Work")],
			labels: [label],
		});
		const result = filterToAllowedProjects(data, ["Work"]);
		expect(result.labels).toHaveLength(1);
	});

	it("returns all data when no projects are configured", () => {
		const data = makeData({
			projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
			sections: [makeSection("s1", "p1")],
			tasks: [makeTask("t1", "p1")],
		});
		const result = filterToAllowedProjects(data, []);
		expect(result.projects).toHaveLength(2);
		expect(result.sections).toHaveLength(1);
		expect(result.tasks).toHaveLength(1);
	});

	it("passes deletedTaskIds through unchanged", () => {
		const data = makeData({
			projects: [makeProject("p1", "Work")],
			deletedTaskIds: ["old1", "old2"],
		});
		const result = filterToAllowedProjects(data, ["Work"]);
		expect(result.deletedTaskIds).toEqual(["old1", "old2"]);
	});

	it("passes completedTaskIds through unchanged", () => {
		const data = makeData({
			projects: [makeProject("p1", "Work")],
			completedTaskIds: ["completed1", "completed2"],
		});
		const result = filterToAllowedProjects(data, ["Work"]);
		expect(result.completedTaskIds).toEqual(["completed1", "completed2"]);
	});
});

describe("sync", () => {
	it("returns counts of synced items", async () => {
		const db = openDb();
		const client = makeMockClient({
			projects: [makeProject("p1", "Work")],
			tasks: [makeTask("t1", "p1")],
			syncToken: "tok1",
		});

		const result = await syncAndPersist(db, client);
		expect(result.data.projects).toHaveLength(1);
		expect(result.data.tasks).toHaveLength(1);
		expect(result.reconciled).toBe(0);
	});

	it("saves the sync token for subsequent incremental syncs", async () => {
		const db = openDb();
		const client = makeMockClient({ syncToken: "tok-abc" });

		await syncAndPersist(db, client);

		expect(client.sync).toHaveBeenCalledWith("*");
		await syncAndPersist(db, client);
		expect(client.sync).toHaveBeenCalledWith("tok-abc");
	});

	it("marks deleted task ids as completed on incremental sync", async () => {
		const db = openDb();
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertTask(makeTask("t1", "p1"));

		const client = makeMockClient({
			deletedTaskIds: ["t1"],
			syncToken: "tok1",
		});
		await syncAndPersist(db, client);

		const row = db.selectTaskById("t1");
		expect(row?.completed).toBe(true);
	});

	it("reconciles tasks missing from full sync response", async () => {
		const db = openDb();
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertTask(makeTask("t-stale", "p1"));

		const client = makeMockClient({
			projects: [makeProject("p1", "Work")],
			tasks: [],
			syncToken: "tok1",
		});

		const result = await syncAndPersist(db, client, [], true);
		expect(result.reconciled).toBe(1);

		const row = db.selectTaskById("t-stale");
		expect(row?.completed).toBe(true);
	});

	it("does not reconcile on incremental syncs", async () => {
		const db = openDb();
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertTask(makeTask("t-stale", "p1"));

		// First full sync keeps t-stale
		const client = makeMockClient({
			projects: [makeProject("p1", "Work")],
			tasks: [makeTask("t-stale", "p1")],
			syncToken: "tok1",
		});
		await syncAndPersist(db, client);

		// Incremental sync — t-stale absent but no reconciliation runs
		const client2 = makeMockClient({ syncToken: "tok2" });
		const result = await syncAndPersist(db, client2);
		expect(result.reconciled).toBe(0);

		const row = db.selectTaskById("t-stale");
		expect(row?.completed).toBe(false);
	});

	it("filters to allowed projects before upserting", async () => {
		const db = openDb();
		const client = makeMockClient({
			projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
			tasks: [makeTask("t1", "p1"), makeTask("t2", "p2")],
			syncToken: "tok1",
		});

		const result = await syncAndPersist(db, client, ["Work"]);
		expect(result.data.projects).toHaveLength(1);
		expect(result.data.tasks).toHaveLength(1);

		const allTasks = db.selectTasksByFilters({});
		expect(allTasks.map((t) => t.id)).toEqual(["t1"]);
	});

	it("smoke test: separates completed tasks from deleted tasks", async () => {
		const db = openDb();
		const completedTask = makeTask("t2", "p1");
		const client = makeMockClient({
			projects: [makeProject("p1", "Work")],
			tasks: [
				makeTask("t1", "p1"), // active task
				{ ...completedTask, is_completed: 1 }, // completed task
			],
			completedTaskIds: ["t2"],
			deletedTaskIds: [],
			syncToken: "tok1",
		});

		const result = await syncAndPersist(db, client);
		expect(result.data.projects).toHaveLength(1);
		expect(result.data.tasks).toHaveLength(2); // Both active and completed tasks are upserted

		// Verify both tasks exist in DB with correct completion status
		const allTasks = db.selectTasksByFilters({ includeCompleted: true });
		expect(allTasks).toHaveLength(2);
		const t1 = allTasks.find((t) => t.id === "t1");
		const t2 = allTasks.find((t) => t.id === "t2");
		expect(t1?.completed).toBe(false);
		expect(t2?.completed).toBe(true);
	});
});
