import { createHash } from "node:crypto";
import type {
	Database,
	DbFilter,
	DbLabel,
	DbNote,
	DbSection,
	DbTask,
} from "./db.ts";

/**
 * SyncLifecycle manages the sync token and enforces the critical invariant:
 * Sync token and data state must always advance or stay the same together.
 *
 * All token reads and atomic writes happen through this module.
 * This ensures the invariant is enforced in exactly one place.
 */

/**
 * Version of the DB schema + transform layer that produced the stored rows.
 *
 * The local sync token only guarantees "I have seen every change under the
 * scope it was issued for." That scope is (1) the allowlisted project IDs and
 * (2) the schema/transform version below. Bump this string whenever
 * `SCHEMA_SQL` (db.ts) or the transforms in db-transform.ts change in a way
 * that affects how stored rows are interpreted. The sync fingerprint folds
 * this version in so an incremental sync is never trusted across a
 * schema/transform change.
 */
export const SYNC_SCOPE_VERSION = "1";

/**
 * Compute the scope fingerprint for a sync.
 *
 * A hash of the sorted allowed-project IDs plus the schema/transform version.
 * The `version` parameter defaults to {@link SYNC_SCOPE_VERSION} but is
 * injectable so tests can exercise version-drift detection without editing
 * the shipped constant.
 *
 * @param allowedProjects Project IDs the local DB is scoped to
 * @param version Schema/transform version (defaults to the shipped constant)
 * @returns Hex SHA-256 fingerprint
 */
export function computeSyncFingerprint(
	allowedProjects: string[],
	version: string = SYNC_SCOPE_VERSION,
): string {
	const canonical = JSON.stringify({
		v: version,
		p: [...allowedProjects].sort(),
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Get the stored sync-scope fingerprint (test utility / inspection).
 *
 * Returns null when no sync has happened yet or the DB predates fingerprinting.
 */
export function getSyncFingerprint(db: Database): string | null {
	return db.getMeta("sync_token_fingerprint");
}

/**
 * Persist the sync-scope fingerprint alongside the token.
 */
export function setSyncFingerprint(db: Database, fingerprint: string): void {
	db.setMeta("sync_token_fingerprint", fingerprint);
}

/**
 * Clear the sync-scope fingerprint (test utility).
 */
export function resetSyncFingerprint(db: Database): void {
	db.deleteMeta("sync_token_fingerprint");
}

/**
 * Default staleness budget for auto full-sync escalation.
 *
 * When the last *full* sync is older than this, the next incremental sync
 * escalates to a full sync so the store self-heals against any delta that
 * slipped through unnoticed (e.g. a task moved out of the synced scope, whose
 * payload was then dropped from the incremental response).
 *
 * ~24h: long enough that normal incremental syncs are never disturbed, short
 * enough that a missed-delta bug is corrected within a day without anyone
 * remembering to run a full sync by hand.
 */
export const STALENESS_BUDGET_MS = 24 * 60 * 60 * 1000;

/** Meta key holding the ISO timestamp of the last full sync. */
const LAST_FULL_SYNC_AT_KEY = "last_full_sync_at";

/**
 * Get the timestamp of the last full sync.
 *
 * Returns null when no full sync has been recorded yet (first run or a DB
 * that predates this feature). A null value is treated as maximally stale by
 * {@link resolveStalenessBudget}, so the next sync escalates to full and
 * re-covers the whole scope exactly once.
 */
export function getLastFullSyncAt(db: Database): string | null {
	return db.getMeta(LAST_FULL_SYNC_AT_KEY);
}

/**
 * Record the timestamp of a full sync.
 *
 * Only full syncs advance this clock. Incremental syncs deliberately leave it
 * untouched, so it always reflects when the local store was last guaranteed
 * to mirror the server's full state for the current scope.
 */
export function setLastFullSyncAt(db: Database, timestamp: string): void {
	db.setMeta(LAST_FULL_SYNC_AT_KEY, timestamp);
}

/**
 * Clear the last-full-sync timestamp (test utility).
 */
export function resetLastFullSyncAt(db: Database): void {
	db.deleteMeta(LAST_FULL_SYNC_AT_KEY);
}

export interface StalenessResolution {
	/** True when the store must escalate to a full sync on the next fetch. */
	needsFullSync: boolean;
}

/**
 * Resolve the staleness budget and escalate to a full sync when overdue.
 *
 * Reads {@link getLastFullSyncAt}. When it is missing (never fully synced) or
 * older than `budgetMs`, the local store may have missed a delta, so the
 * existing sync token is discarded — the downstream fetch will then use `*`
 * and perform a full sync. Within budget, the incremental token is kept.
 *
 * This layer is deliberately independent of the scope-fingerprint invariant in
 * {@link resolveSyncScope}: both can force a full sync, and either one firing
 * is sufficient. It lives in the same token/sync lifecycle layer as a
 * second, orthogonal line of defense-in-depth.
 *
 * @param db Database instance
 * @param now Current epoch ms (injectable for tests; defaults to Date.now())
 * @param budgetMs Staleness budget in ms (defaults to {@link STALENESS_BUDGET_MS})
 * @returns Whether the next fetch must be a full sync
 */
export function resolveStalenessBudget(
	db: Database,
	now: number = Date.now(),
	budgetMs: number = STALENESS_BUDGET_MS,
): StalenessResolution {
	const lastFull = getLastFullSyncAt(db);
	const isStale = lastFull === null || now - Date.parse(lastFull) > budgetMs;
	if (isStale) {
		// Discard the incremental token so the fetch below uses "*".
		resetToken(db);
	}
	return { needsFullSync: isStale };
}

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

export interface SyncScopeResolution {
	/** Fingerprint of the current scope; persist it with the resulting token. */
	fingerprint: string;
	/** True when the next fetch must be a full sync (`*` token). */
	isFullSync: boolean;
}

/**
 * Resolve the sync scope and enforce the fingerprint invariant.
 *
 * Compares the stored sync-token fingerprint against the fingerprint of the
 * *current* scope (allowed-project IDs + schema/transform version). The stored
 * token is only honest about the scope it was issued under; if the allowlist
 * or transform version has drifted since the token was written, the token is
 * discarded so the next fetch is a full sync and re-covers the new scope.
 *
 * On a mismatch (config drift, transform bump, or first run) the stored token
 * is cleared. When the scopes match, the existing incremental token is kept.
 *
 * @param db Database instance
 * @param allowedProjects Project IDs the local DB is scoped to
 * @param forceFull Force a full sync regardless of fingerprint match
 * @returns The current fingerprint to persist with the resulting token
 */
export function resolveSyncScope(
	db: Database,
	allowedProjects: string[],
	forceFull: boolean,
): SyncScopeResolution {
	const fingerprint = computeSyncFingerprint(allowedProjects);
	const scopeDrifted = getSyncFingerprint(db) !== fingerprint;
	const needsFull = forceFull || scopeDrifted;
	if (needsFull) {
		resetToken(db);
	}
	return { fingerprint, isFullSync: needsFull };
}

export interface MutationPersistOptions {
	token: string;
	tasks?: DbTask[];
	labels?: DbLabel[];
	sections?: DbSection[];
	notes?: DbNote[];
	filters?: DbFilter[];
	deletedFilterIds?: string[];
}

/**
 * Atomically persist mutations (token + mutated resources).
 *
 * Used after sending a command to Todoist API. The API returns a syncToken
 * and the mutated resource(s). This function wraps them in a transaction
 * to ensure token and data always stay synchronized.
 *
 * Pass tasks/labels/sections/notes/filters for upserts, and
 * deletedFilterIds for filter deletions. The token is updated last
 * to maintain the invariant that token and data stay synchronized.
 *
 * @param db Database instance
 * @param options Mutation data: token + resources to upsert or delete
 */
export function persistMutations(
	db: Database,
	options: MutationPersistOptions,
): void {
	db.transaction(() => {
		const { token, tasks, labels, sections, notes, filters, deletedFilterIds } =
			options;

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
		if (notes) {
			for (const n of notes) {
				db.upsertNote(n);
			}
		}
		if (filters) {
			for (const f of filters) {
				db.upsertFilter(f);
			}
		}
		if (deletedFilterIds) {
			for (const id of deletedFilterIds) {
				db.deleteFilterById(id);
			}
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
 * that token and data stay synchronized. The {@link computeSyncFingerprint |
 * scope fingerprint} is written in the same transaction as the token so the
 * two stay honest about the scope the token was issued under.
 *
 * @param db Database instance
 * @param token New sync token from API
 * @param operations Callback to perform data upserts, marking, reconciliation, etc.
 *                   Should return the reconciliation count (0 if none).
 * @param fingerprint Scope fingerprint to persist alongside the token
 * @param isFullSync True when this sync was a full sync (`*` token); records the
 *                   last-full-sync timestamp so the staleness budget can later
 *                   decide whether an incremental sync must escalate to full.
 *                   Required (no default): a missing value must not silently
 *                   record an incremental sync as full and reset the staleness
 *                   clock, which would defeat the self-healing defense.
 * @returns Reconciliation count from the operations callback
 */
export function persistSync(
	db: Database,
	token: string,
	operations: () => number,
	fingerprint: string,
	isFullSync: boolean,
): number {
	return db.transaction(() => {
		const reconciled = operations();
		// Token update is last in the transaction; ensures atomicity
		db.setSyncToken(token);
		db.setLastSyncedAt(new Date().toISOString());
		setSyncFingerprint(db, fingerprint);
		// Only full syncs advance the staleness clock: an incremental sync that
		// slipped a delta would otherwise reset how long we can trust the store.
		if (isFullSync) {
			setLastFullSyncAt(db, new Date().toISOString());
		}
		return reconciled;
	});
}
