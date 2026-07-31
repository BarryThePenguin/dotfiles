/**
 * Wayfinder tracker factory for the Pi extension.
 *
 * The extension speaks the domain-level WayfinderTracker interface. Storage
 * is selected here: local Markdown by default, or Todoist via doist-core
 * when `TODOIST_API_TOKEN` is set and a `.doistrc` is present.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	createContainer,
	DoistCoreTodoistGateway,
	LocalMarkdownTracker,
	syncAndPersist,
	TodoistTracker,
	type WayfinderTracker,
} from "issue-tools-core";

export type TrackerMode = "local" | "todoist";

export type CreateWayfinderTrackerOptions = {
	cwd: string;
	mode: TrackerMode;
};

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, ".scratch");
}

export function detectTrackerSelection(cwd: string): TrackerMode | null {
	if (existsSync(localTrackerRoot(cwd))) {
		return "local";
	}
	const container = createContainer();
	if (container.paths && container.listProjectIds().length > 0) {
		return "todoist";
	}
	return null;
}

export async function buildTodoistTracker(): Promise<WayfinderTracker> {
	const container = createContainer();
	if (!container.paths) {
		throw new Error("Could not create Todoist tracker: no-config");
	}
	const projectIds = container.listProjectIds();
	if (projectIds.length === 0) {
		throw new Error("Could not create Todoist tracker: no-projects");
	}

	await syncAndPersist(container.db, container.client, projectIds, false);

	const gateway = new DoistCoreTodoistGateway({
		db: container.db,
		client: container.client,
	});
	const [projectId] = projectIds;
	return new TodoistTracker(gateway, projectId ? { projectId } : {});
}

export async function createWayfinderTracker({
	cwd,
	mode,
}: CreateWayfinderTrackerOptions): Promise<WayfinderTracker> {
	if (mode === "local") {
		return new LocalMarkdownTracker(localTrackerRoot(cwd));
	}
	return buildTodoistTracker();
}
