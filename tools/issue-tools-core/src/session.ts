import { resolve } from "node:path";
import type { TrackerModules } from "./modules.ts";
import { resolveClaimant } from "./claimant.ts";

export type TrackerMode = "local" | "todoist";

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, ".scratch");
}

export type SessionState = { activeMap: string | null };

export interface SessionStateStore {
	read(): SessionState;
	write(state: SessionState): void;
}

export function createInMemorySessionStateStore(
	initial?: SessionState,
): SessionStateStore {
	let state: SessionState = initial ?? { activeMap: null };
	return {
		read: () => state,
		write: (s) => {
			state = s;
		},
	};
}

export type TrackerSessionOptions = {
	/** The repository the session is scoped to. */
	cwd: string;
	/** Selects which Issue tracker this session uses. */
	selectMode: () => Promise<TrackerMode>;
	/** Builds the domain modules for the local tracker. */
	buildLocalModules: () => TrackerModules;
	/** Builds the domain modules for the Todoist tracker. */
	buildTodoistModules: () => Promise<TrackerModules>;
	/** Persists the session's active map across calls. */
	store: SessionStateStore;
	/** Called after any state change so the host can refresh its status display. */
	updateStatus: (state: {
		mode: TrackerMode | null;
		activeMap: string | null;
	}) => void;
};

export type TrackerSession = {
	get: () => Promise<TrackerModules>;
	getCwd: () => string;
	getClaimant: () => Promise<string>;
	getActiveMap: () => string | null;
	getMode: () => TrackerMode | null;
	resolveMapId: (explicitMapId: string | undefined) => string | null;
	setActiveMap: (mapId: string) => void;
	refresh: () => void;
	reset: () => void;
};

/**
 * Owns tracker selection, session state, initialization, synchronization, and
 * module retention behind one small interface. The in-flight build is cached
 * as well as its result so concurrent tool calls cannot start duplicate
 * selections or constructions. A failed selection or build is evicted so a
 * later call retries the whole sequence from scratch.
 */
export function createTrackerSession({
	cwd,
	selectMode,
	buildLocalModules,
	buildTodoistModules,
	store,
	updateStatus,
}: TrackerSessionOptions): TrackerSession {
	let modules: Promise<TrackerModules> | null = null;
	let claimant: Promise<string> | null = null;
	let mode: TrackerMode | null = null;
	let activeMap: string | null = store.read().activeMap;

	const sessionState = () => ({ mode, activeMap });

	return {
		async get() {
			if (!modules) {
				const pending = (async () => {
					mode = await selectMode();
					return mode === "local" ? buildLocalModules() : buildTodoistModules();
				})();
				const cached = pending.catch((error: unknown) => {
					if (modules === cached) {
						modules = null;
					}
					throw error;
				});
				modules = cached;
			}
			const result = await modules;
			updateStatus(sessionState());
			return result;
		},
		getCwd() {
			return cwd;
		},
		getClaimant() {
			if (!claimant) {
				const pending = resolveClaimant(cwd).catch((error: unknown) => {
					if (claimant === pending) {
						claimant = null;
					}
					throw error;
				});
				claimant = pending;
			}
			return claimant;
		},
		getActiveMap() {
			return activeMap;
		},
		getMode() {
			return mode;
		},
		resolveMapId(explicitMapId) {
			return explicitMapId ?? activeMap;
		},
		setActiveMap(mapId) {
			activeMap = mapId;
			store.write({ activeMap });
			updateStatus(sessionState());
		},
		refresh() {
			updateStatus(sessionState());
		},
		reset() {
			modules = null;
		},
	};
}
