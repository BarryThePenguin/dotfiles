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
import { createStateStore } from "./state.ts";

export type ClaudeSession = TrackerSession & {
	setTrackerMode(mode: TrackerMode | "auto"): void;
};

export function createClaudeSession(cwd: string): ClaudeSession {
	const state = createStateStore(cwd);

	const store: SessionStateStore = {
		read: () => ({ activeMap: state.read().activeMap }),
		write: ({ activeMap }) => {
			state.write({ ...state.read(), activeMap });
		},
	};

	const session = createTrackerSession({
		cwd,
		selectMode: () =>
			Promise.resolve(
				state.read().mode ??
					(detectTrackerSelection(cwd) === "todoist" ? "todoist" : "local"),
			),
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
