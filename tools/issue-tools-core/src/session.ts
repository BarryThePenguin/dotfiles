import { resolve } from "node:path";
import type { TrackerModules } from "./modules.ts";
import { resolveClaimant } from "./claimant.ts";

export type TrackerMode = "local" | "todoist";

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, ".scratch");
}

export type TrackerSessionOptions<TExt> = {
	/** The repository the session is scoped to. */
	cwd: string;
	/** Selects which Issue tracker this session uses. */
	selectMode: (ext: TExt) => Promise<TrackerMode>;
	/** Builds the domain modules for the local tracker. */
	buildLocalModules: () => TrackerModules;
	/** Builds the domain modules for the Todoist tracker. */
	buildTodoistModules: () => Promise<TrackerModules>;
	/** Persists the session's active map. */
	persistState: (activeMap: string | null) => void;
	/** Refreshes the host's status from the session's state. */
	updateStatus: (
		ext: TExt,
		state: { mode: TrackerMode | null; activeMap: string | null },
	) => void;
};

export type TrackerSession<TExt = unknown> = {
	get: (ext: TExt) => Promise<TrackerModules>;
	getClaimant: () => Promise<string>;
	getActiveMap: () => string | null;
	getMode: () => TrackerMode | null;
	resolveMapId: (explicitMapId: string | undefined) => string | null;
	setActiveMap: (mapId: string, ext: TExt) => void;
	restore: (state: { activeMap: string | null }) => void;
	refresh: (ext: TExt) => void;
	reset: () => void;
};

/**
 * Owns tracker selection, session state, initialization, synchronization, and
 * module retention behind one small interface. The in-flight build is cached
 * as well as its result so concurrent tool calls cannot start duplicate
 * selections or constructions. A failed selection or build is evicted so a
 * later call retries the whole sequence from scratch.
 *
 * The extension context type `TExt` is generic so every host (Pi, opencode)
 * drives the same lifecycle with its own context type.
 */
export function createTrackerSession<TExt>({
	cwd,
	selectMode,
	buildLocalModules,
	buildTodoistModules,
	persistState,
	updateStatus,
}: TrackerSessionOptions<TExt>): TrackerSession<TExt> {
	let modules: Promise<TrackerModules> | null = null;
	let claimant: Promise<string> | null = null;
	let mode: TrackerMode | null = null;
	let activeMap: string | null = null;

	const state = () => ({ mode, activeMap });

	return {
		async get(ext) {
			if (!modules) {
				const pending = (async () => {
					mode = await selectMode(ext);
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
			updateStatus(ext, state());
			return result;
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
