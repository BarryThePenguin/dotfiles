import { describe, it, expect, beforeEach } from "vitest";
import { Database, type DbTask } from "./db.ts";
import { markDeleted, reconcileCompleted } from "./reconciliation.ts";

describe("Reconciliation", () => {
	let db: Database;

	beforeEach(() => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
	});

	describe("reconcileCompleted", () => {
		it("marks missing tasks as completed during full sync", () => {
			// Setup: DB has 3 tasks
			const tasks: DbTask[] = Array.from({ length: 3 }, (_, i) => ({
				id: `task-${i}`,
				project_id: "proj-1",
				section_id: null,
				content: `Task ${i}`,
				description: null,
				priority: 1,
				due_date: null,
				due_string: null,
				labels: "[]",
				is_completed: 0,
				created_at: "2026-05-23T00:00:00Z",
				synced_at: "2026-05-23T00:00:00Z",
			}));

			for (const task of tasks) {
				db.upsertTask(task);
			}

			// Full sync only returns 2 tasks (task-0 and task-1)
			const returnedIds = new Set(["task-0", "task-1"]);

			const reconciled = reconcileCompleted(db, ["proj-1"], returnedIds);

			// task-2 should be marked as completed
			expect(reconciled).toBe(1);

			const task2 = db.selectTaskById("task-2");
			expect(task2?.completed).toBe(true);
		});

		it("returns 0 when all tasks are returned", () => {
			const task: DbTask = {
				id: "task-keep",
				project_id: "proj-1",
				section_id: null,
				content: "Keep this",
				description: null,
				priority: 1,
				due_date: null,
				due_string: null,
				labels: "[]",
				is_completed: 0,
				created_at: "2026-05-23T00:00:00Z",
				synced_at: "2026-05-23T00:00:00Z",
			};

			db.upsertTask(task);

			const returnedIds = new Set(["task-keep"]);
			const reconciled = reconcileCompleted(db, ["proj-1"], returnedIds);

			expect(reconciled).toBe(0);

			// Task should still be incomplete
			const result = db.selectTaskById("task-keep");
			expect(result?.completed).toBe(false);
		});
	});

	describe("markDeleted", () => {
		it("marks deleted task IDs as completed", () => {
			const task: DbTask = {
				id: "task-deleted",
				project_id: "proj-1",
				section_id: null,
				content: "Will be deleted",
				description: null,
				priority: 1,
				due_date: null,
				due_string: null,
				labels: "[]",
				is_completed: 0,
				created_at: "2026-05-23T00:00:00Z",
				synced_at: "2026-05-23T00:00:00Z",
			};

			db.upsertTask(task);

			markDeleted(db, ["task-deleted"]);

			const result = db.selectTaskById("task-deleted");
			expect(result?.completed).toBe(true);
		});

		it("handles empty list gracefully", () => {
			// Should not throw
			expect(() => {
				markDeleted(db, []);
			}).not.toThrow();
		});
	});
});
