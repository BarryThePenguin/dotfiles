/**
 * Wayfinder tracker factory for the Pi extension.
 *
 * The extension speaks the domain-level WayfinderTracker interface. Storage is
 * selected here: local Markdown by default when Todoist is not configured, or
 * Todoist via the `doist` CLI when Todoist config is present.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	DoistCliGateway,
	LocalMarkdownTracker,
	TodoistTracker,
	type WayfinderTracker,
} from "wayfinder-core";

export type TrackerMode = "local" | "todoist";

export type CreateWayfinderTrackerOptions = {
	cwd: string;
	mode?: TrackerMode;
};

export type TrackerSelection =
	| {
			mode: TrackerMode;
			source:
				"env" | "existing-local" | "existing-doist" | "session-preference";
			path?: string;
	  }
	| {
			mode: null;
			source: "needs-preference";
	  };

function pathIsDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function pathIsFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function explicitTrackerMode(): TrackerMode | null {
	const mode = process.env["WAYFINDER_TRACKER"]?.toLowerCase();
	return mode === "local" || mode === "todoist" ? mode : null;
}

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, ".scratch");
}

export function findDoistRc(start: string): string | null {
	let current = resolve(start);
	for (;;) {
		const candidate = join(current, ".doistrc");
		if (pathIsFile(candidate)) {
			return candidate;
		}
		if (existsSync(join(current, ".git"))) {
			return null;
		}
		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

export function detectTrackerSelection(cwd: string): TrackerSelection {
	const explicitMode = explicitTrackerMode();
	if (explicitMode) {
		return { mode: explicitMode, source: "env" };
	}

	const localRoot = localTrackerRoot(cwd);
	if (pathIsDirectory(localRoot)) {
		return { mode: "local", source: "existing-local", path: localRoot };
	}

	const doistRc = findDoistRc(cwd);
	if (doistRc) {
		return { mode: "todoist", source: "existing-doist", path: doistRc };
	}

	return { mode: null, source: "needs-preference" };
}

export function selectedTrackerMode(cwd?: string): TrackerMode {
	if (cwd) {
		const selection = detectTrackerSelection(cwd);
		return selection.mode ?? "local";
	}
	return explicitTrackerMode() ?? "local";
}

export function createWayfinderTracker({
	cwd,
	mode = selectedTrackerMode(cwd),
}: CreateWayfinderTrackerOptions): WayfinderTracker {
	if (mode === "local") {
		return new LocalMarkdownTracker(localTrackerRoot(cwd));
	}
	return new TodoistTracker(new DoistCliGateway(), {
		...(process.env["WAYFINDER_TODOIST_PROJECT_ID"]
			? { projectId: process.env["WAYFINDER_TODOIST_PROJECT_ID"] }
			: {}),
	});
}
