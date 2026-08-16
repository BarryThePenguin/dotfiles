import { createTrackerModulesFromBackend } from "./modules.ts";
import type { TrackerModules } from "./modules.ts";
import { LocalMarkdownAdapter } from "./local-markdown-adapter.ts";

/** Build the complete local tracker rooted at the supplied directory. */
export function createLocalTrackerModules(rootDir: string): TrackerModules {
	return createTrackerModulesFromBackend(new LocalMarkdownAdapter(rootDir));
}
