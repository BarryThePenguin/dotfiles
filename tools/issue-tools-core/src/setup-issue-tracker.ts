/**
 * Setup wiring for the generic Issue tracker.
 *
 * Pure setup helpers used by the Pi `/setup-issue-tracker` command:
 *
 * - `detectSetupMode(cwd)` — figures out which tracker the repo wants
 *   (`.scratch/` → local, `.doistrc` → Todoist, otherwise ambiguous).
 * - `applyRepoMarker(projects, projectId)` — returns the new list with
 *   `repo: true` set on the given project, cleared on every other. The
 *   implementation lives in `doist-core` so the on-disk format
 *   invariants are owned in one place; this module re-exports it.
 * - `toolInventory()` — the extension's full tool list, derived from
 *   the schema constants so the docs cannot drift from the registered
 *   surface.
 *
 * The command's UI prompts and the hand-off to the setup skill are
 * handled in the Pi extension; this module owns the deterministic
 * pieces so they can be tested.
 */

import { applyRepoMarker } from "doist-core";
import {
	PiIssueToolNames,
	PiToolNames,
	PiWayfinderToolNames,
} from "./tool-schemas.ts";

export { applyRepoMarker };

export type SetupMode = "local" | "todoist" | "ambiguous";

export function detectSetupMode(
	cwd: string,
	options: { hasScratchDir: boolean; hasDoistrc: boolean },
): SetupMode {
	if (options.hasScratchDir && options.hasDoistrc) {
		return "ambiguous";
	}
	if (options.hasScratchDir) {
		return "local";
	}
	if (options.hasDoistrc) {
		return "todoist";
	}
	void cwd;
	return "ambiguous";
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
