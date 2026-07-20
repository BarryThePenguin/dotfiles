import type { Database } from "./db.ts";

/**
 * Task state reconciliation.
 *
 * Handles marking tasks as completed when they are deleted remotely
 * or become stale (not returned in a full sync response).
 *
 * Filtering of allowed projects is handled separately in filtering.ts
 * for better separation of concerns.
 */

/**
 * Reconcile completed tasks.
 *
 * If we're doing a full sync, mark all tasks in allowed projects that aren't
 * in the sync response as completed (they were deleted remotely).
 *
 * @returns Number of tasks marked as completed
 */
export function reconcileCompleted(
	db: Database,
	projectId: string[],
	returnedTaskIds: Set<string>,
): number {
	if (projectId.length === 0) {
		return 0;
	}

	const stale = db.selectTasks({ projectId });
	const missing = stale.filter((r) => !returnedTaskIds.has(r.id));
	if (missing.length === 0) {
		return 0;
	}

	db.updateTasksAsCompleted(missing.map((t) => t.id));
	return missing.length;
}

/**
 * Remove remotely deleted tasks from the local database.
 *
 * Todoist returns a list of task IDs that were deleted.
 * These should be removed from local storage.
 */
export function markDeleted(db: Database, ids: string[]): void {
	db.deleteTasksByIds(ids);
}
