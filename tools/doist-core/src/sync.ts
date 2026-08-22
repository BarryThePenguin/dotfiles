import type { Database } from "./db.ts";
import { logger } from "./logger.ts";
import { markDeleted, reconcileCompleted } from "./reconciliation.ts";
import { prepareNoteForDB } from "./db-transform.ts";
import {
	getToken,
	persistSync,
	resetToken,
	resolveStalenessBudget,
	resolveSyncScope,
	STALENESS_BUDGET_MS,
} from "./sync-lifecycle.ts";
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

		// The local store mirrors the entire account; project scoping is a
		// read-time concern (the project lens), never a write-time filter.
		// Persist the raw response unchanged so the sync token honestly
		// corresponds to everything that was stored.
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
		return { raw, isFullSync };
	};
}

/**
 * Fetch the sync response without persisting.
 *
 * The local store mirrors the entire account, so the response is returned
 * unfiltered — what you see here is exactly what a subsequent persist would
 * write. Project scoping is applied at read time via the project lens, not
 * here. Does NOT update the sync token; the next sync will include the same
 * data.
 *
 * @param db Database instance
 * @param client TodoistClient for API calls
 * @param allowedProjects Project IDs/names used for logging/diagnostics
 * @param full Force a full sync (reset token before fetching)
 * @returns Raw sync response with updated data
 */
export async function syncAndFetch(
	db: Database,
	client: TodoistClient,
	allowedProjects: string[] = [],
	full = false,
): Promise<AllData> {
	const { raw } = await createSyncHelper(
		db,
		client,
		allowedProjects,
		full,
	)(true);
	return raw;
}

/**
 * Sync, reconcile, and persist atomically.
 *
 * Fetches changes from Todoist and persists the response unchanged — the local
 * store mirrors the entire account; project scoping happens at read time via
 * the project lens, never here. Remotely-deleted tasks are removed,
 * remotely-completed tasks are marked completed, and all changes (including
 * the sync token) are written in a single atomic transaction. On full sync,
 * reconciles tasks that vanished from the server.
 *
 * @param db Database instance
 * @param client TodoistClient for API calls
 * @param allowedProjects Project IDs/names used for the scope fingerprint
 * @param full Force a full sync (reset token before fetching)
 * @returns Persist result with the raw sync response and reconciliation count
 */
export async function syncAndPersist(
	db: Database,
	client: TodoistClient,
	allowedProjects: string[] = [],
	full = false,
	stalenessBudgetMs: number = STALENESS_BUDGET_MS,
): Promise<SyncAndPersistResult> {
	// Self-healing escalation: when the last full sync is older than the
	// staleness budget, the incremental token is no longer trustworthy enough
	// and the next fetch escalates to a full sync. This is orthogonal to the
	// scope-fingerprint check below — either one firing forces a full sync.
	const staleness = resolveStalenessBudget(db, Date.now(), stalenessBudgetMs);
	const fullSync = full || staleness.needsFullSync;

	// Enforce the fingerprint invariant before fetching: discard the stored
	// token (forcing a full sync) when the current scope — allowed-project IDs
	// plus the schema/transform version — differs from the scope the stored
	// token was issued under.
	const { fingerprint } = resolveSyncScope(db, allowedProjects, fullSync);

	// Persist the raw response verbatim. The store is a full mirror of
	// Todoist; scoping is a read-time concern handled by the project lens.
	const { raw, isFullSync } = await createSyncHelper(
		db,
		client,
		allowedProjects,
		fullSync,
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
	} = raw;

	const reconciled = persistSync(
		db,
		raw.syncToken,
		() => {
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
			// On full sync, reconcile against the full mirror: only tasks that are
			// absent from the response entirely (genuinely completed/deleted on the
			// server) are marked completed. A task that merely moved — present in
			// the response under a different project — is re-scoped by the upsert
			// above and must never be marked completed.
			return isFullSync
				? reconcileCompleted(
						db,
						projects.map((p) => p.id),
						new Set(tasks.map((t) => t.id)),
					)
				: 0;
		},
		fingerprint,
		isFullSync,
	);

	if (reconciled > 0) {
		logger.info(
			{ reconciled_count: reconciled },
			"syncAndPersist: reconciled completed tasks",
		);
	}

	return { data: raw, reconciled };
}
