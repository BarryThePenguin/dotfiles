import type { SubagentMode } from "./modes.ts";
import type { ParallelRunSnapshot } from "./parallel-run.ts";
import type { SingleResult } from "./types.ts";

export interface SubagentDetails {
	mode: SubagentMode;
	results: SingleResult[];
	snapshot?: ParallelRunSnapshot;
}
