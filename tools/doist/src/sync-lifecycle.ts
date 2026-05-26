import type { Database, DbTask, DbLabel, DbSection } from "./db.ts";

/**
 * SyncLifecycle manages the sync token and enforces the critical invariant:
 * Sync token and data state must always advance or stay the same together.
 *
 * All token reads and atomic writes happen through this module.
 * This ensures the invariant is enforced in exactly one place.
 */

/**
 * Get the current sync token.
 *
 * Returns null if no sync has happened yet (forces full sync on next call).
 * Token of "*" means "full sync from the beginning".
 */
export function getToken(db: Database): string | null {
	return db.getSyncToken();
}

/**
 * Set the current sync token (test utility).
 *
 * Normally token updates only happen via persistMutations() or persistSync()
 * to maintain the invariant. This function is exported for test convenience.
 *
 * Returns true if successful, false if it failed (e.g., database unavailable).
 */
export function setToken(db: Database, token: string): boolean {
	try {
		db.setSyncToken(token);
		return true;
	} catch (error) {
		console.error("Failed to update sync token:", error);
		return false;
	}
}

/**
 * Clear the sync token, forcing a full sync on the next call.
 *
 * Useful when the database becomes stale or after certain errors.
 */
export function resetToken(db: Database): void {
	db.resetSyncToken();
}

export interface MutationPersistOptions {
	token: string;
	tasks?: DbTask[];
	labels?: DbLabel[];
	sections?: DbSection[];
	customOperations?: (db: Database) => void;
}

/**
 * Atomically persist mutations (token + mutated resources).
 *
 * Used after sending a command to Todoist API. The API returns a syncToken
 * and the mutated resource(s). This function wraps them in a transaction
 * to ensure token and data always stay synchronized.
 *
 * For simple upserts, pass tasks/labels/sections arrays.
 * For custom operations (e.g., markCompleted), use the customOperations callback.
 *
 * @param db Database instance
 * @param options Mutation data: token + resources and/or custom operations
 */
export function persistMutations(
	db: Database,
	options: MutationPersistOptions,
): void {
	db.transaction(() => {
		const { token, tasks, labels, sections, customOperations } = options;

		if (tasks) {
			for (const t of tasks) {
				db.upsertTask(t);
			}
		}
		if (labels) {
			for (const l of labels) {
				db.upsertLabel(l);
			}
		}
		if (sections) {
			for (const s of sections) {
				db.upsertSection(s);
			}
		}

		if (customOperations) {
			customOperations(db);
		}

		// Token update is last in the transaction; ensures atomicity
		db.setSyncToken(token);
	});
}

/**
 * Atomically persist a full sync response with custom data operations.
 *
 * Used by the periodic sync workflow. Wraps the transaction boundary
 * and ensures the sync token is updated last, maintaining the invariant
 * that token and data stay synchronized.
 *
 * @param db Database instance
 * @param token New sync token from API
 * @param operations Callback to perform data upserts, marking, reconciliation, etc.
 *                   Should return the reconciliation count (0 if none).
 * @returns Reconciliation count from the operations callback
 */
export function persistSync(
	db: Database,
	token: string,
	operations: () => number,
): number {
	return db.transaction(() => {
		const reconciled = operations();
		// Token update is last in the transaction; ensures atomicity
		db.setSyncToken(token);
		db.setLastSyncedAt(new Date().toISOString());
		return reconciled;
	});
}
