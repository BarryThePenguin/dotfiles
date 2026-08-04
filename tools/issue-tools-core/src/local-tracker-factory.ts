import { createTrackerModulesFromBackend } from "./modules.ts";
import type { TrackerModules } from "./modules.ts";
import { LocalMarkdownAdapter } from "./local-markdown-adapter.ts";

/** Build the complete local tracker from one shared storage adapter. */
export function createLocalTrackerModules(rootDir: string): TrackerModules {
	return createTrackerModulesFromBackend(new LocalMarkdownAdapter(rootDir));
}
