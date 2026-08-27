/**
 * Subagent extension for pi — fork of the example subagent extension
 * (examples/extensions/subagent), adapted per the wayfinder "Subagents in pi" map.
 *
 * Fork deltas over the example (locked by the map's decisions):
 *  - Roster surfaced to the parent model: promptSnippet + promptGuidelines name
 *    every agent so the parent can choose organically (research gap 2).
 *  - Alias surface: agent names pass through resolveAgentName —
 *    `general-purpose` → `general` (code-review), `Explore` → `explore`
 *    (improve-codebase-architecture, case-insensitive).
 *  - Persona override layer: .pi/personas.json (nearest-up from cwd) merges
 *    { provider?, model?, thinkingLevel? } over agents.md frontmatter; the child
 *    spawn passes --provider and --thinking when set.
 *  - Background command: /subagent-bg spawns one or more detached `pi --mode rpc`
 *    children (one per line, up to MAX_PARALLEL_TASKS, PARALLEL_CONCURRENCY at a
 *    time), each with its own session-dir for resumability; each result is
 *    injected via sendUserMessage independently as that child settles (gap 1).
 */

import * as path from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents.ts";
import { OpenCodeGoUsageClient, RoutingMetrics } from "opencode-go-usage";
import { createBackgroundCommandHandler } from "./background.ts";
import { executeSubagent } from "./execute.ts";
import { renderCall, renderResult } from "./render.ts";
import { SubagentParams } from "./schema.ts";
import { formatGoUsageStatus, GO_USAGE_STATUS_KEY } from "./go-usage-status.ts";

// ────────────────────────────────────────────────────────────────────────────
// Extension
// ────────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const rosterAgents = discoverAgents().agents;
	const usageClient = new OpenCodeGoUsageClient();
	const routingMetrics = new RoutingMetrics();
	let usageTimer: ReturnType<typeof setInterval> | undefined;

	const refreshUsageStatus = async (ctx: ExtensionContext) => {
		const result = await usageClient.get();
		const status = formatGoUsageStatus(result);
		ctx.ui.setStatus(
			GO_USAGE_STATUS_KEY,
			ctx.ui.theme.fg(status.color, status.text),
		);
	};

	pi.on("session_start", async (_event, ctx) => {
		await refreshUsageStatus(ctx);
		if (!usageTimer) {
			usageTimer = setInterval(
				() => void refreshUsageStatus(ctx),
				10 * 60 * 1000,
			);
		}
	});
	const rosterLine =
		rosterAgents.map((a) => `${a.name} — ${a.description}`).join(" | ") ||
		"none";

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized user-level subagents with isolated context windows (each runs in a separate pi process).",
			"Supported modes: single (agent + task) and parallel (tasks array, max 8, 4 concurrent).",
			"Parallel tasks carry a per-task watchdog (default 10 minutes, override via taskTimeoutMs or a task's own timeoutMs); a stalled task is killed and reported as failed so the rest of the batch still settles.",
			`Agents are discovered only from ${path.join(getAgentDir(), "agents")}.`,
			`Per-project persona overrides come from .pi/personas.json ({ provider?, model?, thinkingLevel?, quotaFallback? } keyed by agent name). Quota fallbacks are opt-in for low-stakes parallel/background work.`,
			`Agents: ${rosterLine}`,
		].join(" "),
		parameters: SubagentParams,
		promptSnippet:
			rosterAgents.length > 0
				? `Delegate bounded tasks to isolated-context subagents: ${rosterAgents.map((a) => a.name).join(", ")}`
				: "Delegate bounded tasks to isolated-context subagents",
		promptGuidelines: [
			'Use subagent with agent: "general" (alias general-purpose) when you need bounded work done in an isolated pi process — parallel review axes, background research briefs, or design-it-twice alternatives.',
			'Use subagent with agent: "explore" (alias Explore) for read-only organic codebase exploration; it cannot modify files.',
			"Use parallel mode ({ tasks: [...] }, max 8 tasks, 4 concurrent) when independent chunks can run concurrently.",
		],
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			executeSubagent(
				toolCallId,
				params,
				signal,
				onUpdate,
				ctx,
				routingMetrics,
			),
		renderCall,
		renderResult,
	});

	pi.registerCommand("subagent-bg", {
		description:
			"Spawn detached background subagents (default agent: general). Usage: /subagent-bg [agent:<name>] <brief>, one per line to run several in parallel (max 8, 4 concurrent). Each result is injected independently as that subagent settles.",
		handler: createBackgroundCommandHandler(pi),
	});
}
