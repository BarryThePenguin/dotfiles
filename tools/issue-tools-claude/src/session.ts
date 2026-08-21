import {
	createFileStateStore,
	createLocalTrackerModules,
	createTodoistTrackerModules,
	createTrackerSession,
	localTrackerRoot,
	resolveTrackerMode,
	type SessionStateStore,
	type TrackerMode,
	type TrackerSession,
} from "issue-tools-core";

type LocalSessionState = { mode?: TrackerMode; activeMap: string | null };

export type ClaudeSession = TrackerSession & {
	setTrackerMode(mode: TrackerMode | "auto"): void;
};

export function createClaudeSession(cwd: string): ClaudeSession {
	const state = createFileStateStore<LocalSessionState>(cwd, "claude", {
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
		selectMode: () => Promise.resolve(resolveTrackerMode(cwd, state.read().mode)),
		buildLocalModules: () => createLocalTrackerModules(localTrackerRoot(cwd)),
		buildTodoistModules: () => createTodoistTrackerModules(cwd),
		store,
		updateStatus: () => {},
	});

	return {
		...session,
		setTrackerMode(mode: TrackerMode | "auto") {
			state.write({
				...(mode !== "auto" && { mode }),
				activeMap: state.read().activeMap,
			});
			session.invalidate();
		},
	};
}
