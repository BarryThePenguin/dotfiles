import { describe, expect, it } from "vitest";
import { filterToAllowedProjects } from "./filtering.ts";
import { syncAndPersist } from "./sync.ts";
import { createTestContainer } from "./test-helpers/container.ts";
import {
	makeData,
	makeProject,
	makeSection,
	makeTask,
	NOW,
} from "./test-helpers/fixtures.ts";

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
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work")],
				tasks: [makeTask("t1", "p1")],
				syncToken: "tok1",
			}),
		);

		const result = await syncAndPersist(db, client);
		expect(result.data.projects).toHaveLength(1);
		expect(result.data.tasks).toHaveLength(1);
		expect(result.reconciled).toBe(0);
	});

	it("saves the sync token for subsequent incremental syncs", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(makeData({ syncToken: "tok-abc" }));

		await syncAndPersist(db, client);
		expect(client.sync).toHaveBeenCalledWith("*");
		await syncAndPersist(db, client);
		expect(client.sync).toHaveBeenCalledWith("tok-abc");
	});

	it("deletes tasks listed in deletedTaskIds on incremental sync", async () => {
		const { db, client } = createTestContainer();
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertTask(makeTask("t1", "p1"));

		client.sync.mockResolvedValue(
			makeData({
				deletedTaskIds: ["t1"],
				syncToken: "tok1",
			}),
		);

		await syncAndPersist(db, client);

		const row = db.getTaskById("t1");
		expect(row).toBeNull();
	});

	it("marks completed task ids as completed on incremental sync", async () => {
		const { db, client } = createTestContainer();
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertTask(makeTask("t1", "p1"));

		client.sync.mockResolvedValue(
			makeData({
				completedTaskIds: ["t1"],
				syncToken: "tok1",
			}),
		);
		await syncAndPersist(db, client);

		const row = db.getTaskById("t1");
		expect(row?.isCompleted).toBe(true);
	});

	it("reconciles tasks missing from full sync response", async () => {
		const { db, client } = createTestContainer();
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertTask(makeTask("t-stale", "p1"));

		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work")],
				tasks: [],
				syncToken: "tok1",
			}),
		);

		const result = await syncAndPersist(db, client, [], true);
		expect(result.reconciled).toBe(1);

		const row = db.getTaskById("t-stale");
		expect(row?.isCompleted).toBe(true);
	});

	it("does not reconcile on incremental syncs", async () => {
		const { db, client } = createTestContainer();
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertTask(makeTask("t-stale", "p1"));

		// First full sync keeps t-stale
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work")],
				tasks: [makeTask("t-stale", "p1")],
				syncToken: "tok1",
			}),
		);
		await syncAndPersist(db, client);

		// Incremental sync — t-stale absent but no reconciliation runs
		client.sync.mockResolvedValueOnce(
			makeData({
				syncToken: "tok2",
			}),
		);
		const result = await syncAndPersist(db, client);
		expect(result.reconciled).toBe(0);

		const row = db.getTaskById("t-stale");
		expect(row?.isCompleted).toBe(false);
	});

	it("filters to allowed projects before upserting", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				tasks: [makeTask("t1", "p1"), makeTask("t2", "p2")],
				syncToken: "tok1",
			}),
		);

		const result = await syncAndPersist(db, client, ["Work"]);
		expect(result.data.projects).toHaveLength(1);
		expect(result.data.tasks).toHaveLength(1);

		const allTasks = db.selectTasks();
		expect(allTasks.map((t) => t.id)).toEqual(["t1"]);
	});

	it("smoke test: separates completed tasks from deleted tasks", async () => {
		const { db, client } = createTestContainer();
		const completedTask = makeTask("t2", "p1");
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work")],
				tasks: [
					makeTask("t1", "p1"), // active task
					{ ...completedTask, is_completed: 1 }, // completed task
				],
				completedTaskIds: ["t2"],
				deletedTaskIds: [],
				syncToken: "tok1",
			}),
		);

		const result = await syncAndPersist(db, client);
		expect(result.data.projects).toHaveLength(1);
		expect(result.data.tasks).toHaveLength(2); // Both active and completed tasks are upserted

		// Verify both tasks exist in DB with correct completion status
		const allTasks = db.selectTasks({ completed: "any" });
		expect(allTasks).toHaveLength(2);
		const t1 = allTasks.find((t) => t.id === "t1");
		const t2 = allTasks.find((t) => t.id === "t2");
		expect(t1?.isCompleted).toBe(false);
		expect(t2?.isCompleted).toBe(true);
	});
});
