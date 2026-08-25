import { describe, expect, it } from "vitest";
import { countSyncData, syncAndPersist } from "./sync.ts";
import { createTestContainer } from "./test-helpers/container.ts";
import {
	computeSyncFingerprint,
	getLastFullSyncAt,
	getSyncFingerprint,
	getToken,
	setLastFullSyncAt,
	setSyncFingerprint,
	setToken,
} from "./sync-lifecycle.ts";
import {
	makeData,
	makeProject,
	makeSection,
	makeTask,
	NOW,
} from "./test-helpers/fixtures.ts";

describe("persist-everything contract", () => {
	it("persists the full response, not just the allowed scope", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				sections: [makeSection("s1", "p1"), makeSection("s2", "p2")],
				tasks: [makeTask("t1", "p1"), makeTask("t2", "p2")],
				syncToken: "tok1",
			}),
		);

		const result = await syncAndPersist(db, client, ["Work"]);

		// The returned data mirrors everything (the DB is a full mirror).
		expect(result.data.projects).toHaveLength(2);
		expect(result.data.tasks).toHaveLength(2);

		// And the DB actually stored every project and task.
		expect(
			db
				.selectProjects()
				.map((p) => p.id)
				.sort(),
		).toEqual(["p1", "p2"]);
		expect(
			db
				.selectTasks({ completed: "any" })
				.map((t) => t.id)
				.sort(),
		).toEqual(["t1", "t2"]);

		// Reads are scoped by the project lens, not the write path: a lens
		// restricted to "Work" sees only t1.
		expect(
			db
				.selectTasks({ completed: "any", projectScope: ["Work"] })
				.map((t) => t.id),
		).toEqual(["t1"]);
	});

	it("re-scopes a task that moved out of the lens on its incremental delta", async () => {
		const { db, client } = createTestContainer();
		// First sync: task lives in the allowed project.
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work")],
				tasks: [makeTask("t1", "p1")],
				syncToken: "tok1",
			}),
		);
		await syncAndPersist(db, client, ["Work"]);
		expect(db.getTaskById("t1")?.projectId).toBe("p1");

		// Incremental sync reports the same task now living in another project.
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				tasks: [makeTask("t1", "p2")],
				syncToken: "tok2",
			}),
		);
		await syncAndPersist(db, client, ["Work"]);

		// The row is re-scoped rather than dropped — no ghost lingers as active.
		const row = db.getTaskById("t1");
		expect(row?.projectId).toBe("p2");
		expect(row?.isCompleted).toBe(false);

		// The lens no longer shows it as active in the repo's scope.
		const lensTasks = db.selectTasks({
			completed: "incomplete",
			projectScope: ["Work"],
		});
		expect(lensTasks.map((t) => t.id)).toEqual([]);
	});

	it("heals a move-out-of-scope via a full re-sync without marking it completed", async () => {
		const { db, client } = createTestContainer();
		// Seed a task in the allowed project (simulating a pre-existing ghost
		// whose move delta was previously dropped before persist).
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertProject(makeProject("p2", "Personal"));
		db.upsertTask(makeTask("t1", "p1"));

		// A full sync returns the task — but under its new project.
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				tasks: [makeTask("t1", "p2")],
				syncToken: "tok-full",
			}),
		);

		const result = await syncAndPersist(db, client, ["Work"], true);

		// It is present in the response, so reconciliation must not complete it.
		expect(result.reconciled).toBe(0);
		const row = db.getTaskById("t1");
		expect(row?.projectId).toBe("p2");
		expect(row?.isCompleted).toBe(false);

		// And the allowed-scope read is clean (no ghost active row).
		const lensTasks = db.selectTasks({
			completed: "incomplete",
			projectScope: ["Work"],
		});
		expect(lensTasks.map((t) => t.id)).toEqual([]);
	});

	it("full-sync reconciliation marks only genuinely-absent tasks completed", async () => {
		const { db, client } = createTestContainer();
		// t-kept stays in the response (still active, just re-scoped).
		// t-gone is absent entirely → genuinely completed/deleted remotely.
		db.upsertProject(makeProject("p1", "Work"));
		db.upsertProject(makeProject("p2", "Personal"));
		db.upsertTask(makeTask("t-kept", "p1"));
		db.upsertTask(makeTask("t-gone", "p1"));

		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				tasks: [makeTask("t-kept", "p2")],
				syncToken: "tok-full",
			}),
		);

		const result = await syncAndPersist(db, client, ["Work"], true);

		expect(result.reconciled).toBe(1);
		expect(db.getTaskById("t-kept")?.isCompleted).toBe(false);
		expect(db.getTaskById("t-kept")?.projectId).toBe("p2");
		expect(db.getTaskById("t-gone")?.isCompleted).toBe(true);
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

	it("persists every project without dropping the out-of-scope ones", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				tasks: [makeTask("t1", "p1"), makeTask("t2", "p2")],
				syncToken: "tok1",
			}),
		);

		const result = await syncAndPersist(db, client, ["Work"]);
		// The whole response is returned, not just the allowed slice.
		expect(result.data.projects).toHaveLength(2);
		expect(result.data.tasks).toHaveLength(2);

		// Both tasks are stored; scoping is a read-time concern.
		const allTasks = db.selectTasks({ completed: "any" });
		expect(allTasks.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
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

	it("persists filters from sync response", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work")],
				filters: [
					{
						id: "f1",
						name: "Today",
						query: "today",
						color: "blue",
						item_order: 1,
						is_favorite: 0,
						synced_at: NOW,
					},
					{
						id: "f2",
						name: "Triage",
						query: "overdue | today",
						color: "red",
						item_order: 2,
						is_favorite: 1,
						synced_at: NOW,
					},
				],
				syncToken: "tok1",
			}),
		);

		const result = await syncAndPersist(db, client);
		expect(result.data.filters).toHaveLength(2);

		const filters = db.selectFilters();
		expect(filters).toHaveLength(2);
		expect(filters[0]?.id).toBe("f1");
		expect(filters[0]?.name).toBe("Today");
		expect(filters[1]?.id).toBe("f2");
		expect(filters[1]?.name).toBe("Triage");
	});

	it("overwrites filters on re-sync", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(
			makeData({
				filters: [
					{
						id: "f1",
						name: "V1",
						query: "today",
						color: null,
						item_order: 0,
						is_favorite: 0,
						synced_at: NOW,
					},
				],
				syncToken: "tok1",
			}),
		);

		await syncAndPersist(db, client);
		expect(db.selectFilters()[0]?.name).toBe("V1");

		client.sync.mockResolvedValue(
			makeData({
				filters: [
					{
						id: "f1",
						name: "V2",
						query: "today",
						color: null,
						item_order: 0,
						is_favorite: 0,
						synced_at: NOW,
					},
				],
				syncToken: "tok2",
			}),
		);

		await syncAndPersist(db, client);
		const filters = db.selectFilters();
		expect(filters).toHaveLength(1);
		expect(filters[0]?.name).toBe("V2");
	});

	it("persists the scope fingerprint alongside the token", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work")],
				syncToken: "tok1",
			}),
		);

		await syncAndPersist(db, client, ["p1"]);

		expect(getToken(db)).toBe("tok1");
		expect(getSyncFingerprint(db)).toBe(computeSyncFingerprint(["p1"]));
	});

	it("continues incremental syncs when the allowlist is unchanged", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work")],
				syncToken: "tok1",
			}),
		);
		await syncAndPersist(db, client, ["p1"]);
		expect(client.sync).toHaveBeenNthCalledWith(1, "*");

		// Allowlist unchanged → existing token reused (incremental).
		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok2" }));
		await syncAndPersist(db, client, ["p1"]);
		expect(client.sync).toHaveBeenNthCalledWith(2, "tok1");
	});

	it("forces a full sync after a project is added to the allowlist", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work")],
				syncToken: "tok1",
			}),
		);
		await syncAndPersist(db, client, ["p1"]);
		expect(client.sync).toHaveBeenNthCalledWith(1, "*");

		// Allowlist grew → stored token is no longer honest; force full sync.
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				syncToken: "tok2",
			}),
		);
		await syncAndPersist(db, client, ["p1", "p2"]);
		expect(client.sync).toHaveBeenNthCalledWith(2, "*");
		expect(getSyncFingerprint(db)).toBe(computeSyncFingerprint(["p1", "p2"]));
	});

	it("forces a full sync after a project is removed from the allowlist", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work"), makeProject("p2", "Personal")],
				syncToken: "tok1",
			}),
		);
		await syncAndPersist(db, client, ["p1", "p2"]);
		expect(client.sync).toHaveBeenNthCalledWith(1, "*");

		// Allowlist shrank → stored token is no longer honest; force full sync.
		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work")],
				syncToken: "tok2",
			}),
		);
		await syncAndPersist(db, client, ["p1"]);
		expect(client.sync).toHaveBeenNthCalledWith(2, "*");
		expect(getSyncFingerprint(db)).toBe(computeSyncFingerprint(["p1"]));
	});

	it("forces a full sync when the scope fingerprint is missing (legacy DB)", async () => {
		const { db, client } = createTestContainer();
		// Simulate a pre-fingerprint database that already holds a token.
		setToken(db, "tok-legacy");
		expect(getSyncFingerprint(db)).toBeNull();

		client.sync.mockResolvedValue(
			makeData({
				projects: [makeProject("p1", "Work")],
				syncToken: "tok1",
			}),
		);
		await syncAndPersist(db, client, ["p1"]);
		// A full sync is forced because the token's scope cannot be trusted.
		expect(client.sync).toHaveBeenCalledWith("*");
	});

	it("forces exactly one full re-sync after a transform/version bump", async () => {
		const { db, client } = createTestContainer();
		// Simulate a database written under the previous transform version: a
		// token is present with a fingerprint computed at the old version. Bumping
		// SYNC_SCOPE_VERSION changes the current fingerprint, so the stored token
		// is no longer trusted and a full sync must re-fetch everything once.
		setToken(db, "tok-old");
		setSyncFingerprint(db, computeSyncFingerprint(["p1"], "1"));

		client.sync.mockResolvedValueOnce(
			makeData({
				projects: [makeProject("p1", "Work")],
				syncToken: "tok-new",
			}),
		);
		await syncAndPersist(db, client, ["p1"]);
		// The version drift forces a full re-sync to backfill dropped data.
		expect(client.sync).toHaveBeenCalledWith("*");
		expect(getSyncFingerprint(db)).toBe(computeSyncFingerprint(["p1"]));

		// The next sync is incremental again: the backfill happened exactly once.
		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok-incr" }));
		await syncAndPersist(db, client, ["p1"]);
		expect(client.sync).toHaveBeenLastCalledWith("tok-new");
	});
});

describe("staleness-budget auto full sync", () => {
	it("records last_full_sync_at on a full sync", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValue(makeData({ syncToken: "tok1" }));

		await syncAndPersist(db, client);

		expect(getLastFullSyncAt(db)).not.toBeNull();
	});

	it("keeps a fresh incremental sync incremental (no escalation)", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok1" }));
		await syncAndPersist(db, client);
		expect(client.sync).toHaveBeenNthCalledWith(1, "*");

		const before = getLastFullSyncAt(db);

		// Immediately after a full sync: well within the 24h budget.
		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok2" }));
		await syncAndPersist(db, client);

		// Incremental token reused; staleness clock untouched.
		expect(client.sync).toHaveBeenNthCalledWith(2, "tok1");
		expect(getLastFullSyncAt(db)).toBe(before);
	});

	it("escalates a stale incremental sync to a full sync", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok1" }));
		await syncAndPersist(db, client);
		expect(client.sync).toHaveBeenNthCalledWith(1, "*");

		// Simulate the last full sync having happened >24h ago.
		setLastFullSyncAt(
			db,
			new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
		);
		const before = getLastFullSyncAt(db);

		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok2" }));
		await syncAndPersist(db, client);

		// Budget elapsed → full sync re-fetch.
		expect(client.sync).toHaveBeenNthCalledWith(2, "*");
		const after = getLastFullSyncAt(db);
		expect(after).not.toBe(before);
		expect(Date.parse(after ?? "")).toBeGreaterThan(Date.now() - 5000);
	});

	it("honors an injected staleness budget", async () => {
		const { db, client } = createTestContainer();
		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok1" }));
		await syncAndPersist(db, client);

		// Only 2h old, but a 1h budget makes it stale.
		setLastFullSyncAt(
			db,
			new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
		);
		client.sync.mockResolvedValueOnce(makeData({ syncToken: "tok2" }));
		await syncAndPersist(db, client, [], false, 60 * 60 * 1000);

		expect(client.sync).toHaveBeenNthCalledWith(2, "*");
	});
});

describe("countSyncData", () => {
	it("counts filters in sync data", () => {
		const data = makeData({
			filters: [
				{
					id: "f1",
					name: "A",
					query: "today",
					color: null,
					item_order: 0,
					is_favorite: 0,
					synced_at: NOW,
				},
				{
					id: "f2",
					name: "B",
					query: "tomorrow",
					color: null,
					item_order: 1,
					is_favorite: 0,
					synced_at: NOW,
				},
			],
		});
		const result = countSyncData(data);
		expect(result.filters).toBe(2);
	});

	it("returns 0 filters when none present", () => {
		const result = countSyncData(makeData());
		expect(result.filters).toBe(0);
	});
});
