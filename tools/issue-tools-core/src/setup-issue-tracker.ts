/**
 * Setup wiring for the generic Issue tracker.
 *
 * Pure setup helpers used by the Pi `/setup-issue-tracker` command:
 *
 * - `detectTrackerSelection(cwd)` — the raw fact of which
 *   Issue tracker the repo can use: a `.scratch/` directory selects Local
 *   Markdown; a `.doistrc` with at least one Project selects Todoist. Call
 *   sites keep their own interpretation of `both` and `neither` (prompt vs.
 *   default).
 *
 * The command's UI prompts and the hand-off to the setup skill are
 * handled in the Pi extension; this module owns the deterministic
 * pieces so they can be tested.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { hasProjects } from "doist-core";

export type TrackerSelection = "local" | "todoist" | "both" | "neither";

/** The directory marker that selects the Local Markdown tracker. */
const LOCAL_TRACKER_MARKER = ".scratch";

export function detectTrackerSelection(cwd: string): TrackerSelection {
	const hasScratch = existsSync(join(cwd, LOCAL_TRACKER_MARKER));
	const hasTodoist = hasProjects(cwd);
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
