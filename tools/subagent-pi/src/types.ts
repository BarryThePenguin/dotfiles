import type { Message } from "@earendil-works/pi-ai";
import type { AgentConfig } from "./agents.ts";
import type { EffectiveSpawnConfig } from "./personas.ts";

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "user" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string | undefined;
}

/** Everything needed to launch one child process. */
export interface SpawnContext {
	agent: AgentConfig;
	task: string;
	cwd: string;
	effective: EffectiveSpawnConfig;
}

export function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}
