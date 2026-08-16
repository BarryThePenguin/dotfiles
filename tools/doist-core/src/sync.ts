import type { Database } from "./db.ts";
import { filterToAllowedProjects } from "./filtering.ts";
import { logger } from "./logger.ts";
import { markDeleted, reconcileCompleted } from "./reconciliation.ts";
import { prepareNoteForDB } from "./schema.ts";
import { getToken, persistSync, resetToken } from "./sync-lifecycle.ts";
import type { AllData, TodoistClient } from "./todoist.ts";

export type SyncResult = {
	projects: number;
	sections: number;
	labels: number;
	filters: number;
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
		filters: data.filters.length,
		tasks: data.tasks.length,
		reconciled,
	};
}

function createSyncHelper(
	db: Database,
	client: TodoistClient,
	allowedProjects: string[],
	full: boolean,
) {
	if (full) {
		resetToken(db);
	}
	const token = getToken(db) ?? "*";
	const isFullSync = token === "*";

	return async (log = false) => {
		const tokenLabel =
			token === "*" ? "FULL_SYNC" : `token_${token.slice(0, 8)}...`;
		if (log) {
			logger.info(
				{ token: tokenLabel, allowedProjects },
				"syncAndFetch: syncing",
			);
		}

		const raw = await client.sync(token);
		if (log) {
			logger.info(
				{
					tasks_in_response: raw.tasks.length,
					projects_in_response: raw.projects.length,
					sections_in_response: raw.sections.length,
					labels_in_response: raw.labels.length,
					filters_in_response: raw.filters.length,
					has_syncToken: !!raw.syncToken,
					task_ids: raw.tasks.map((t) => t.id),
				},
				"syncAndFetch: received sync response",
			);
		}

		const filtered = filterToAllowedProjects(raw, allowedProjects);
		if (log) {
			logger.info(
				{
					filtered_tasks: filtered.tasks.length,
					task_ids_after_filter: filtered.tasks.map((t) => t.id),
				},
				"syncAndFetch: after filtering to allowed projects",
			);
		}
		return { raw, filtered, isFullSync };
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
	const { filtered } = await createSyncHelper(
		db,
		client,
		allowedProjects,
		full,
	)(true);
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
	const { raw, filtered, isFullSync } = await createSyncHelper(
		db,
		client,
		allowedProjects,
		full,
	)();

	const {
		projects,
		sections,
		labels,
		filters,
		tasks,
		notes,
		deletedTaskIds,
		deletedNoteIds,
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
		for (const f of filters) {
			db.upsertFilter(f);
		}
		for (const t of tasks) {
			db.upsertTask(t);
		}
		for (const n of notes) {
			const prepared = prepareNoteForDB(n);
			if (prepared) {
				db.upsertNote(prepared);
			}
		}

		// Some incremental sync responses report closures via completedTaskIds
		// without returning full item payloads.
		db.updateTasksAsCompleted(completedTaskIds);
		markDeleted(db, deletedTaskIds);
		db.deleteNotesByIds(deletedNoteIds);
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
