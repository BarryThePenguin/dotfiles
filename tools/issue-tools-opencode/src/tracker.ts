/**
 * opencode tracker session.
 *
 * Selects the Issue tracker for a worktree, builds the domain modules, and
 * persists mode + active map through the shared issue-tools-core session
 * lifecycle. Unlike the Pi extension (which asks via the TUI and stores state
 * in the session), opencode resolves the mode deterministically and keeps a
 * durable per-worktree state file.
 */

import {
	createLocalTrackerModules,
	createTodoistTrackerModules,
	createTrackerSession,
	detectTrackerSelection,
	localTrackerRoot,
	type TrackerMode,
	type TrackerModules,
} from "issue-tools-core";
import { createStateStore, type StateStore } from "./state.ts";

/** Marker for "no extension context to thread through" (opencode tools carry no UI). */
const NO_EXT = undefined as unknown;

export type OpenCodeSession = {
	get(): Promise<TrackerModules>;
	getClaimant(): Promise<string>;
	getActiveMap(): string | null;
	getMode(): TrackerMode | null;
	resolveMapId(explicitMapId: string | undefined): string | null;
	setActiveMap(mapId: string): void;
	setTrackerMode(mode: TrackerMode | "auto"): void;
};

/**
 * Deterministic mode selection: an explicit override wins, otherwise the
 * markers decide. `both` and `neither` fall back to local, matching the Pi
 * extension's no-UI default; callers can force Todoist via setTrackerMode.
 */
export function resolveMode(
	worktree: string,
	override: TrackerMode | undefined,
): TrackerMode {
	if (override) {
		return override;
	}
	const selection = detectTrackerSelection(worktree);
	return selection === "todoist" ? "todoist" : "local";
}

export function createOpenCodeSession(worktree: string): OpenCodeSession {
	const state: StateStore = createStateStore(worktree);
	const session = buildSession();

	function buildSession() {
		return createTrackerSession({
			cwd: worktree,
			selectMode: () =>
				Promise.resolve(resolveMode(worktree, state.read().mode)),
			buildLocalModules: () =>
				createLocalTrackerModules(localTrackerRoot(worktree)),
			buildTodoistModules: () => createTodoistTrackerModules(worktree),
			persistState: (activeMap) => {
				const currentMode = session.getMode();
				state.write({
					...(currentMode != null && { mode: currentMode }),
					activeMap,
				});
			},
			updateStatus: () => {},
		});
	}

	const restored = state.read().activeMap;
	if (restored) {
		session.restore({ activeMap: restored });
	}

	return {
		get: () => session.get(NO_EXT),
		getClaimant: session.getClaimant,
		getActiveMap: session.getActiveMap,
		getMode: session.getMode,
		resolveMapId: session.resolveMapId,
		setActiveMap: (mapId) => {
			session.setActiveMap(mapId, NO_EXT);
		},
		setTrackerMode(mode) {
			state.write({
				...(mode !== "auto" && { mode }),
				activeMap: session.getActiveMap(),
			});
			session.reset();
		},
	};
}

const sessionsByWorktree = new Map<string, OpenCodeSession>();

export function getOpenCodeSession(worktree: string): OpenCodeSession {
	let session = sessionsByWorktree.get(worktree);
	if (!session) {
		session = createOpenCodeSession(worktree);
		sessionsByWorktree.set(worktree, session);
	}
	return session;
}

export function resetOpenCodeSession(worktree: string): void {
	sessionsByWorktree.delete(worktree);
}
