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
	createContainer,
	selectRepoProject,
	syncAndPersist,
	type Container,
} from "doist-core";
import {
	LocalMarkdownPersistenceAdapter,
	TodoistAdapter,
	createTrackerModules as createDomainModules,
	type TrackerModules,
} from "issue-tools-core";

export type TrackerMode = "local" | "todoist";

export type CreateWayfinderTrackerOptions = {
	cwd: string;
	mode: TrackerMode;
};

export function pickRepoProjectId(container: Container): string | undefined {
	if (!container.paths) {
		return undefined;
	}
	const projects = container.listProjects();
	const selected = selectRepoProject(projects);
	return selected?.id;
}

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, ".scratch");
}

export async function buildTrackerModules(): Promise<TrackerModules> {
	const container = createContainer();
	if (!container.paths) {
		throw new Error("Could not create Todoist tracker: no-config");
	}
	const projectIds = container.listProjectIds();
	if (projectIds.length === 0) {
		throw new Error("Could not create Todoist tracker: no-projects");
	}

	await syncAndPersist(container.db, container.client, projectIds, false);

	const repoProjectId = pickRepoProjectId(container);
	const adapter = new TodoistAdapter(
		container.db,
		container.client,
		repoProjectId ? { projectId: repoProjectId } : {},
	);
	return createDomainModules(adapter);
}

export async function createTrackerModules({
	cwd,
	mode,
}: CreateWayfinderTrackerOptions): Promise<TrackerModules> {
	if (mode === "local") {
		const adapter = new LocalMarkdownPersistenceAdapter(localTrackerRoot(cwd));
		return createDomainModules(adapter);
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
};

export type TrackerSession = {
	get(ext: ExtensionContext): Promise<TrackerModules>;
	reset(): void;
};

/**
 * Lazily constructs one Tracker for the lifetime of a Tracker session.
 *
 * The session owns selection, initialization, synchronization, and module
 * retention behind a single small interface. The in-flight build is cached as
 * well as its result so concurrent tool calls cannot start duplicate
 * selections or constructions. A failed selection or build is evicted so a
 * later call retries the whole sequence from scratch.
 */
export function createTrackerSession({
	cwd,
	selectMode,
	buildModules,
}: TrackerSessionOptions): TrackerSession {
	let modules: Promise<TrackerModules> | null = null;

	return {
		get(ext) {
			if (modules) {
				return modules;
			}

			const pending = (async () => {
				const mode = await selectMode(ext);
				return buildModules({ cwd, mode });
			})();
			const cached = pending.catch((error: unknown) => {
				if (modules === cached) {
					modules = null;
				}
				throw error;
			});
			modules = cached;
			return cached;
		},
		reset() {
			modules = null;
		},
	};
}
