import {
	discoverAgents,
	resolveAgentName,
	type AgentConfig,
} from "./agents.ts";
import {
	effectiveSpawnConfig,
	loadPersonaOverrides,
	type EffectiveSpawnConfig,
	type PersonaOverride,
} from "./personas.ts";
import { type SingleResult, type SpawnContext } from "./run.ts";

export interface SpawnContextOptions {
	agent: AgentConfig;
	task: string;
	cwd: string;
	overrides: Map<string, PersonaOverride>;
	parentProvider?: string | undefined;
}

export interface SpawnContextRequest {
	defaultCwd: string;
	agents: AgentConfig[];
	agentName: string;
	task: string;
	cwd?: string | undefined;
	overrides: Map<string, PersonaOverride>;
	parentProvider?: string | undefined;
}

export type LaunchResolution =
	{ context: SpawnContext } | { result: SingleResult };

export function createSpawnContext(options: SpawnContextOptions): SpawnContext {
	return {
		agent: options.agent,
		task: options.task,
		cwd: options.cwd,
		effective: effectiveSpawnConfig(
			options.agent,
			options.overrides,
			options.parentProvider,
		),
	};
}

function unknownAgentResult(
	agentName: string,
	task: string,
	agents: readonly AgentConfig[],
): SingleResult {
	const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
	return {
		agent: agentName,
		agentSource: "unknown",
		task,
		exitCode: 1,
		messages: [],
		stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
	};
}

/** Pure resolution — testable without filesystem access. */
export function resolveSpawnContext(
	request: SpawnContextRequest,
): LaunchResolution {
	const resolvedName = resolveAgentName(request.agentName);
	const agent = request.agents.find((a) => a.name === resolvedName);
	if (!agent) {
		return {
			result: unknownAgentResult(
				request.agentName,
				request.task,
				request.agents,
			),
		};
	}
	return {
		context: createSpawnContext({
			agent,
			task: request.task,
			cwd: request.cwd ?? request.defaultCwd,
			overrides: request.overrides,
			parentProvider: request.parentProvider,
		}),
	};
}

export interface LaunchContext {
	cwd: string;
	parentProvider?: string | undefined;
}

export interface Launcher {
	/** Discovered agents — available for error messages and roster display. */
	agents: readonly AgentConfig[];
	/** Resolve name → context in one call; uses cached discovery and overrides. */
	resolve(agentName: string, task: string, cwd?: string): LaunchResolution;
}

/**
 * Build a launcher that owns the full pre-spawn pipeline: agent discovery,
 * persona override loading, name resolution, and context assembly.
 * Discovery and overrides are loaded once and shared across all resolve() calls.
 */
export function createLauncher(ctx: LaunchContext): Launcher {
	const { agents } = discoverAgents();
	const overrides = loadPersonaOverrides(ctx.cwd);
	return {
		agents,
		resolve(agentName, task, cwd) {
			return resolveSpawnContext({
				defaultCwd: ctx.cwd,
				agents,
				agentName,
				task,
				cwd,
				overrides,
				parentProvider: ctx.parentProvider,
			});
		},
	};
}
