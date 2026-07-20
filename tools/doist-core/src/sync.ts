import type { Database } from "./db.ts";
import { filterToAllowedProjects } from "./filtering.ts";
import { logger } from "./logger.ts";
import { markDeleted, reconcileCompleted } from "./reconciliation.ts";
import { getToken, persistSync, resetToken } from "./sync-lifecycle.ts";
import type { AllData, TodoistClient } from "./todoist.ts";

export type SyncResult = {
	projects: number;
	sections: number;
	labels: number;
	tasks: number;
	reconciled: number;
};

/**
 * Result of a persist operation: filtered sync data + reconciliation count.
 */
export interface SyncAndPersistResult {
	data: AllData;
	reconciled: number;
}

/**
 * Convenience helper to compute sync statistics from sync data.
 *
 * @param dataOrResult Sync data (AllData) or persist result (SyncAndPersistResult)
 * @returns Sync statistics (resource counts)
 */
export function countSyncData(
	dataOrResult: AllData | SyncAndPersistResult,
): SyncResult {
	const data = "data" in dataOrResult ? dataOrResult.data : dataOrResult;
	const reconciled = "reconciled" in dataOrResult ? dataOrResult.reconciled : 0;
	return {
		projects: data.projects.length,
		sections: data.sections.length,
		labels: data.labels.length,
		tasks: data.tasks.length,
		reconciled,
	};
}

/**
 * Fetch and filter sync response without persisting.
 *
 * Returns the raw sync data (filtered to allowed projects) for inspection.
 * Does NOT update the sync token; the next sync will include the same data.
 *
 * @param db Database instance
 * @param client TodoistClient for API calls
 * @param allowedProjects Project IDs/names to keep (empty = all)
 * @param full Force a full sync (reset token before fetching)
 * @returns Filtered sync response with updated data
 */
export async function syncAndFetch(
	db: Database,
	client: TodoistClient,
	allowedProjects: string[] = [],
	full = false,
): Promise<AllData> {
	if (full) {
		resetToken(db);
	}
	const token = getToken(db) ?? "*";
	const tokenLabel =
		token === "*" ? "FULL_SYNC" : `token_${token.slice(0, 8)}...`;
	logger.info({ token: tokenLabel, allowedProjects }, "syncAndFetch: syncing");
	const raw = await client.sync(token);

	logger.info(
		{
			tasks_in_response: raw.tasks.length,
			projects_in_response: raw.projects.length,
			sections_in_response: raw.sections.length,
			labels_in_response: raw.labels.length,
			has_syncToken: !!raw.syncToken,
			task_ids: raw.tasks.map((t) => t.id),
		},
		"syncAndFetch: received sync response",
	);

	const filtered = filterToAllowedProjects(raw, allowedProjects);
	logger.info(
		{
			filtered_tasks: filtered.tasks.length,
			task_ids_after_filter: filtered.tasks.map((t) => t.id),
		},
		"syncAndFetch: after filtering to allowed projects",
	);
	return filtered;
}

/**
 * Sync, reconcile, and persist atomically.
 *
 * Fetches changes from Todoist, filters to allowed projects,
 * removes remotely-deleted tasks, marks remotely-completed tasks as completed,
 * and persists all changes
 * (including sync token) in a single atomic transaction.
 * On full sync, reconciles completed tasks.
 *
 * @param db Database instance
 * @param client TodoistClient for API calls
 * @param allowedProjects Project IDs/names to keep (empty = all)
 * @param full Force a full sync (reset token before fetching)
 * @returns Persist result with filtered sync response and reconciliation count
 */
export async function syncAndPersist(
	db: Database,
	client: TodoistClient,
	allowedProjects: string[] = [],
	full = false,
): Promise<SyncAndPersistResult> {
	if (full) {
		resetToken(db);
	}
	const token = getToken(db) ?? "*";
	const isFullSync = token === "*";
	const raw = await client.sync(token);
	const filtered = filterToAllowedProjects(raw, allowedProjects);

	const {
		projects,
		sections,
		labels,
		tasks,
		deletedTaskIds,
		completedTaskIds,
	} = filtered;

	const reconciled = persistSync(db, raw.syncToken, () => {
		for (const p of projects) {
			db.upsertProject(p);
		}
		for (const s of sections) {
			db.upsertSection(s);
		}
		for (const l of labels) {
			db.upsertLabel(l);
		}
		for (const t of tasks) {
			db.upsertTask(t);
		}

		// Some incremental sync responses report closures via completedTaskIds
		// without returning full item payloads.
		db.updateTasksAsCompleted(completedTaskIds);
		markDeleted(db, deletedTaskIds);
		return isFullSync
			? reconcileCompleted(
					db,
					projects.map((p) => p.id),
					new Set(tasks.map((t) => t.id)),
				)
			: 0;
	});

	if (reconciled > 0) {
		logger.info(
			{ reconciled_count: reconciled },
			"syncAndPersist: reconciled completed tasks",
		);
	}

	return { data: filtered, reconciled };
}
