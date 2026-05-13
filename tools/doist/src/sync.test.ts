import { describe, expect, it, vi } from "vitest";
import { openDb, upsertProject, upsertTask } from "./db.ts";
import { filterToAllowedProjects, sync } from "./sync.ts";
import type { AllData, TodoistClient } from "./todoist.ts";

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
		deletedTaskIds: [],
		syncToken: null,
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
});

describe("sync", () => {
	it("returns counts of synced items", async () => {
		const db = openDb(":memory:");
		const client = makeMockClient({
			projects: [makeProject("p1", "Work")],
			tasks: [makeTask("t1", "p1")],
			syncToken: "tok1",
		});

		const result = await sync(db, client);
		expect(result.projects).toBe(1);
		expect(result.tasks).toBe(1);
		expect(result.reconciled).toBe(0);
	});

	it("saves the sync token for subsequent incremental syncs", async () => {
		const db = openDb(":memory:");
		const client = makeMockClient({ syncToken: "tok-abc" });

		await sync(db, client);

		expect(client.sync).toHaveBeenCalledWith("*");
		await sync(db, client);
		expect(client.sync).toHaveBeenCalledWith("tok-abc");
	});

	it("marks deleted task ids as completed on incremental sync", async () => {
		const db = openDb(":memory:");
		upsertProject(db, makeProject("p1", "Work"));
		upsertTask(db, makeTask("t1", "p1"));

		const client = makeMockClient({
			deletedTaskIds: ["t1"],
			syncToken: "tok1",
		});
		await sync(db, client);

		const row = db.get(
			db.q
				.selectFrom("tasks")
				.select("is_completed")
				.where("id", "=", "t1")
				.compile(),
		);
		expect(row?.is_completed).toBe(1);
	});

	it("reconciles tasks missing from full sync response", async () => {
		const db = openDb(":memory:");
		upsertProject(db, makeProject("p1", "Work"));
		upsertTask(db, makeTask("t-stale", "p1"));

		const client = makeMockClient({
			projects: [makeProject("p1", "Work")],
			tasks: [],
			syncToken: "tok1",
		});

		const result = await sync(db, client);
		expect(result.reconciled).toBe(1);

		const row = db.get(
			db.q
				.selectFrom("tasks")
				.select("is_completed")
				.where("id", "=", "t-stale")
				.compile(),
		);
		expect(row?.is_completed).toBe(1);
	});

	it("does not reconcile on incremental syncs", async () => {
		const db = openDb(":memory:");
		upsertProject(db, makeProject("p1", "Work"));
		upsertTask(db, makeTask("t-stale", "p1"));

		// First full sync keeps t-stale
		const client = makeMockClient({
			projects: [makeProject("p1", "Work")],
			tasks: [makeTask("t-stale", "p1")],
			syncToken: "tok1",
		});
		await sync(db, client);

		// Incremental sync — t-stale absent but no reconciliation runs
		const client2 = makeMockClient({ syncToken: "tok2" });
		const result = await sync(db, client2);
		expect(result.reconciled).toBe(0);

		const row = db.get(
			db.q
				.selectFrom("tasks")
				.select("is_completed")
				.where("id", "=", "t-stale")
				.compile(),
		);
		expect(row?.is_completed).toBe(0);
	});

	it("filters to allowed projects before upserting", async () => {
		const db = openDb(":memory:");
		const client = makeMockClient({
			projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
			tasks: [makeTask("t1", "p1"), makeTask("t2", "p2")],
			syncToken: "tok1",
		});

		const result = await sync(db, client, ["Work"]);
		expect(result.projects).toBe(1);
		expect(result.tasks).toBe(1);

		const allTasks = db.all(db.q.selectFrom("tasks").select("id").compile());
		expect(allTasks.map((t) => t.id)).toEqual(["t1"]);
	});
});
