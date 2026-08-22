import type { Database } from "./db.ts";

/**
 * Task state reconciliation.
 *
 * Handles marking tasks as completed when they are deleted remotely
 * or become stale (not returned in a full sync response).
 *
 * The local store mirrors the entire account; project scoping is a read-time
 * concern handled by the query layer's project lens, not here.
 */

/**
 * Reconcile completed tasks against the full mirror.
 *
 * On a full sync the local store mirrors the entire account, so `projectIds`
 * is the complete set of project IDs returned by the sync (not a scoped
 * subset). Any stored task whose project is in that set but whose ID is absent
 * from the response was genuinely completed or deleted on the server and is
 * marked completed locally. A task that merely moved — present in the response
 * under a different project — is re-scoped by the upsert upstream and is never
 * marked completed here.
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

	const stale = db.selectTasks({ projectId: projectIds });
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
