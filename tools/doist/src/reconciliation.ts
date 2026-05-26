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
	projectIds: string[],
	returnedTaskIds: Set<string>,
): number {
	if (projectIds.length === 0) {
		return 0;
	}

	const stale = db.selectUncompletedTasksByProjectIds(projectIds);
	const missing = stale.filter((r) => !returnedTaskIds.has(r.id));
	if (missing.length === 0) {
		return 0;
	}

	db.updateTasksAsCompleted(missing.map((t) => t.id));
	return missing.length;
}

/**
 * Mark deleted tasks as completed in the database.
 *
 * Todoist returns a list of task IDs that were deleted. We mark them as completed
 * locally rather than actually deleting them (preserves audit trail).
 */
export function markDeleted(db: Database, ids: string[]): void {
	db.updateTasksAsCompleted(ids);
}
