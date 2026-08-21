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
	type SessionStateStore,
	type TrackerMode,
	type TrackerSession,
} from "issue-tools-core";
import { createStateStore, type StateStore } from "./state.ts";

export type OpenCodeSession = Pick<
	TrackerSession,
	"getModules" | "getCwd" | "getClaimant" | "getActiveMap" | "setActiveMap"
> & {
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

	const coreStore: SessionStateStore = {
		read: () => ({ activeMap: state.read().activeMap }),
		write: ({ activeMap }) => {
			const full = state.read();
			state.write({ ...full, activeMap });
		},
	};

	const session = createTrackerSession({
		cwd: worktree,
		selectMode: () => Promise.resolve(resolveMode(worktree, state.read().mode)),
		buildLocalModules: () =>
			createLocalTrackerModules(localTrackerRoot(worktree)),
		buildTodoistModules: () => createTodoistTrackerModules(worktree),
		store: coreStore,
		updateStatus: () => {},
	});

	return {
		getModules: () => session.getModules(),
		getCwd: () => session.getCwd(),
		getClaimant: session.getClaimant,
		getActiveMap: session.getActiveMap,
		setActiveMap: (mapId) => {
			session.setActiveMap(mapId);
		},
		setTrackerMode(mode) {
			state.write({
				...(mode !== "auto" && { mode }),
				activeMap: session.getActiveMap(),
			});
			session.invalidate();
		},
	};
}

export type SessionRegistry = { get(worktree: string): OpenCodeSession };

export function createSessionRegistry(): SessionRegistry {
	const sessions = new Map<string, OpenCodeSession>();
	return {
		get(worktree: string): OpenCodeSession {
			let session = sessions.get(worktree);
			if (!session) {
				session = createOpenCodeSession(worktree);
				sessions.set(worktree, session);
			}
			return session;
		},
	};
}
