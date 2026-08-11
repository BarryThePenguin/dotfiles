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
 *  - Background command: /subagent-bg spawns a detached `pi --mode rpc` child
 *    (session-dir for resumability); results injected via sendUserMessage (gap 1).
 */

import * as path from "node:path";
import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "./agents.ts";
import { createBackgroundCommandHandler, executeSubagent } from "./execute.ts";
import { renderCall, renderResult } from "./render.ts";

// ────────────────────────────────────────────────────────────────────────────
// Tool schema
// ────────────────────────────────────────────────────────────────────────────

const TaskItem = Type.Object({
	agent: Type.String({
		description:
			"Name of the agent to invoke (general, explore; aliases general-purpose, Explore)",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process" }),
	),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description: "Name of the agent to invoke (for single mode)",
		}),
	),
	task: Type.Optional(
		Type.String({ description: "Task to delegate (for single mode)" }),
	),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for parallel execution",
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the agent process (single mode)",
		}),
	),
});

// ────────────────────────────────────────────────────────────────────────────
// Extension
// ────────────────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const rosterAgents = discoverAgents().agents;
	const rosterLine =
		rosterAgents.map((a) => `${a.name} — ${a.description}`).join(" | ") ||
		"none";

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized user-level subagents with isolated context windows (each runs in a separate pi process).",
			"Supported modes: single (agent + task) and parallel (tasks array, max 8, 4 concurrent).",
			`Agents are discovered only from ${path.join(getAgentDir(), "agents")}.`,
			`Per-project persona overrides come from .pi/personas.json ({ provider?, model?, thinkingLevel? } keyed by agent name).`,
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
		execute: executeSubagent,
		renderCall,
		renderResult,
	});

	pi.registerCommand("subagent-bg", {
		description:
			"Spawn a detached background subagent (default agent: general). Usage: /subagent-bg [agent:<name>] <brief>. Results are injected when the subagent settles.",
		handler: createBackgroundCommandHandler(pi),
	});
}
