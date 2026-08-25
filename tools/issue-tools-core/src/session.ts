import { resolve } from "node:path";
import type { TrackerModules } from "./modules.ts";
import { resolveClaimant } from "./claimant.ts";
import { createFileStateStore, type StateStore } from "./state.ts";
import { detectTrackerSelection } from "./setup-issue-tracker.ts";
import { createLocalTrackerModules } from "./local-tracker-factory.ts";
import { createTodoistTrackerModules } from "./todoist-tracker-factory.ts";

export type TrackerMode = "local" | "todoist";

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, ".scratch");
}

/**
 * Resolves the effective tracker mode for a worktree.
 * An explicit override wins; otherwise the presence markers decide,
 * defaulting to local for `both` and `neither`.
 */
export function resolveTrackerMode(
	cwd: string,
	override?: TrackerMode,
): TrackerMode {
	if (override) {
		return override;
	}
	return detectTrackerSelection(cwd) === "todoist" ? "todoist" : "local";
}

export type SessionState = { activeMap: string | null };

export type SessionStateStore = StateStore<SessionState>;

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
	/** Called on construction and after any state change so the host can refresh its status display. */
	updateStatus: (state: {
		mode: TrackerMode | null;
		activeMap: string | null;
		cwd: string;
	}) => void;
};

export type TrackerSession = {
	getModules: () => Promise<{ modules: TrackerModules; mode: TrackerMode }>;
	getCwd: () => string;
	getClaimant: () => Promise<string>;
	getActiveMap: () => string | null;
	setActiveMap: (mapId: string) => void;
	invalidate: () => void;
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
	let modules: Promise<{ modules: TrackerModules; mode: TrackerMode }> | null =
		null;
	let claimant: Promise<string> | null = null;
	let mode: TrackerMode | null = null;
	let activeMap: string | null = store.read().activeMap;

	const sessionState = () => ({ mode, activeMap, cwd });

	const session: TrackerSession = {
		async getModules() {
			if (!modules) {
				const pending = (async () => {
					mode = await selectMode();
					const built =
						mode === "local"
							? buildLocalModules()
							: await buildTodoistModules();
					return { modules: built, mode };
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
		setActiveMap(mapId) {
			activeMap = mapId;
			store.write({ activeMap });
			updateStatus(sessionState());
		},
		invalidate() {
			modules = null;
		},
	};

	updateStatus(sessionState());
	return session;
}

export type FileBackedTrackerSession = TrackerSession & {
	setTrackerMode(mode: TrackerMode | "auto"): void;
};

type FileBackedSessionState = { mode?: TrackerMode; activeMap: string | null };

/**
 * A durable, per-worktree tracker session for hosts with no live status
 * display (mode and active map persist to a JSON file keyed by `host`).
 * Unlike the Pi extension (which asks via the TUI and reflects state live),
 * these hosts resolve mode deterministically and update on next read.
 */
export function createFileBackedTrackerSession(
	cwd: string,
	host: string,
): FileBackedTrackerSession {
	const state = createFileStateStore<FileBackedSessionState>(cwd, host, {
		activeMap: null,
	});

	const store: SessionStateStore = {
		read: () => ({ activeMap: state.read().activeMap }),
		write: ({ activeMap }) => {
			state.write({ ...state.read(), activeMap });
		},
	};

	const session = createTrackerSession({
		cwd,
		selectMode: () =>
			Promise.resolve(resolveTrackerMode(cwd, state.read().mode)),
		buildLocalModules: () => createLocalTrackerModules(localTrackerRoot(cwd)),
		buildTodoistModules: () => createTodoistTrackerModules(cwd),
		store,
		updateStatus: () => {},
	});

	return {
		...session,
		setTrackerMode(mode) {
			state.write({
				...(mode !== "auto" && { mode }),
				activeMap: session.getActiveMap(),
			});
			session.invalidate();
		},
	};
}
