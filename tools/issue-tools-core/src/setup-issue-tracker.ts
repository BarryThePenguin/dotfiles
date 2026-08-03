/**
 * Setup wiring for the generic Issue tracker.
 *
 * Pure setup helpers used by the Pi `/setup-issue-tracker` command:
 *
 * - `detectTrackerSelection(cwd)` — the raw fact of which Issue tracker the
 *   repo can use: a `.scratch/` directory selects Local Markdown; a `.doistrc`
 *   with at least one Project selects Todoist. Call sites keep their own
 *   interpretation of `both` and `neither` (prompt vs. default).
 * - `toolInventory()` — the extension's full tool list, derived from
 *   the schema constants so the docs cannot drift from the registered
 *   surface.
 *
 * The command's UI prompts and the hand-off to the setup skill are
 * handled in the Pi extension; this module owns the deterministic
 * pieces so they can be tested.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createContainer } from "doist-core";
import {
	PiIssueToolNames,
	PiToolNames,
	PiWayfinderToolNames,
} from "./tool-schemas.ts";

export type TrackerSelection = "local" | "todoist" | "both" | "neither";

/** The directory marker that selects the Local Markdown tracker. */
const LOCAL_TRACKER_MARKER = ".scratch";

export function detectTrackerSelection(cwd: string): TrackerSelection {
	const hasScratch = existsSync(join(cwd, LOCAL_TRACKER_MARKER));
	const hasTodoist = hasTodoistProjects(cwd);
	if (hasScratch && hasTodoist) {
		return "both";
	}
	if (hasScratch) {
		return "local";
	}
	if (hasTodoist) {
		return "todoist";
	}
	return "neither";
}

/**
 * A repo can use Todoist when a `.doistrc` with at least one Project is
 * reachable from the cwd. A missing or malformed config reads as "no" —
 * the detector reports what the tracker can actually build.
 */
function hasTodoistProjects(cwd: string): boolean {
	try {
		const container = createContainer(cwd);
		try {
			return container.listProjectIds().length > 0;
		} finally {
			container.close();
		}
	} catch {
		return false;
	}
}

export type ToolInventoryEntry = {
	name: string;
	group: "wayfinder" | "issue";
};

export function toolInventory(): ToolInventoryEntry[] {
	const inventory: ToolInventoryEntry[] = [];
	for (const name of PiWayfinderToolNames) {
		inventory.push({ name, group: "wayfinder" });
	}
	for (const name of PiIssueToolNames) {
		inventory.push({ name, group: "issue" });
	}
	return inventory;
}

export function extensionToolCount(): number {
	return PiToolNames.length;
}
