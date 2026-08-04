/**
 * Wayfinder tracker factory for the Pi extension.
 *
 * The extension speaks the domain-level WayfinderTracker interface. Storage
 * is selected here: local Markdown by default, or Todoist via doist-core
 * when `TODOIST_API_TOKEN` is set and a `.doistrc` is present. The Todoist
 * project is selected repo-aware: a `repo: true` marker on a project picks
 * that one, falling back to the first-listed project.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import {
	createLocalTrackerModules,
	createTodoistTrackerModules,
	selectTodoistRepoProjectId as pickRepoProjectId,
	type TrackerModules,
} from "issue-tools-core";

export type TrackerMode = "local" | "todoist";

export type CreateWayfinderTrackerOptions = {
	cwd: string;
	mode: TrackerMode;
};

export { pickRepoProjectId };

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, ".scratch");
}

export async function buildTrackerModules(): Promise<TrackerModules> {
	return createTodoistTrackerModules();
}

export async function createTrackerModules({
	cwd,
	mode,
}: CreateWayfinderTrackerOptions): Promise<TrackerModules> {
	if (mode === "local") {
		return createLocalTrackerModules(localTrackerRoot(cwd));
	}
	return buildTrackerModules();
}

export type TrackerSessionOptions = {
	/** The repository the session is scoped to. */
	cwd: string;
	/** Selects which Issue tracker this session uses. */
	selectMode: (ext: ExtensionContext) => Promise<TrackerMode>;
	/** Builds the domain modules for the selected tracker. */
	buildModules: (
		options: CreateWayfinderTrackerOptions,
	) => Promise<TrackerModules>;
	/** Persists the session's active map. */
	persistState: (activeMap: string | null) => void;
	/** Refreshes the Pi status from the session's state. */
	updateStatus: (
		ext: ExtensionContext,
		state: { mode: TrackerMode | null; activeMap: string | null },
	) => void;
};

export type TrackerSession = {
	get(ext: ExtensionContext): Promise<TrackerModules>;
	getActiveMap(): string | null;
	getMode(): TrackerMode | null;
	resolveMapId(explicitMapId: string | undefined): string | null;
	setActiveMap(mapId: string, ext: ExtensionContext): void;
	restore(state: { activeMap: string | null }): void;
	refresh(ext: ExtensionContext): void;
	reset(): void;
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
	buildModules,
	persistState,
	updateStatus,
}: TrackerSessionOptions): TrackerSession {
	let modules: Promise<TrackerModules> | null = null;
	let mode: TrackerMode | null = null;
	let activeMap: string | null = null;

	const state = () => ({ mode, activeMap });

	return {
		async get(ext) {
			if (!modules) {
				const pending = (async () => {
					mode = await selectMode(ext);
					return buildModules({ cwd, mode });
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
			updateStatus(ext, state());
			return result;
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
		setActiveMap(mapId, ext) {
			activeMap = mapId;
			persistState(activeMap);
			updateStatus(ext, state());
		},
		restore(restored) {
			activeMap = restored.activeMap;
		},
		refresh(ext) {
			updateStatus(ext, state());
		},
		reset() {
			modules = null;
		},
	};
}
