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

import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	getAgentDir,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";
import { getRequestedModes, type SubagentMode } from "./modes.ts";
import { loadPersonaOverrides } from "./personas.ts";
import {
	createSpawnContext,
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	mapWithConcurrencyLimit,
	resolveSpawnContext,
	runSingleAgent,
	spawnBackgroundAgent,
	truncateOutput,
	type RunSingleAgentOptions,
	type SingleResult,
} from "./run.ts";

const COLLAPSED_ITEM_COUNT = 10;

// ────────────────────────────────────────────────────────────────────────────
// Render helpers (ported from the example)
// ────────────────────────────────────────────────────────────────────────────

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns)
		parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args["command"] as string) || "...";
			const preview =
				command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args["file_path"] || args["path"] || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args["offset"] as number | undefined;
			const limit = args["limit"] as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg(
					"warning",
					`:${startLine}${endLine ? `-${endLine}` : ""}`,
				);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args["file_path"] || args["path"] || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args["content"] || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args["file_path"] || args["path"] || "...") as string;
			return (
				themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath))
			);
		}
		case "ls": {
			const rawPath = (args["path"] || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args["pattern"] || "*") as string;
			const rawPath = (args["path"] || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args["pattern"] || "") as string;
			const rawPath = (args["path"] || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview =
				argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface SubagentDetails {
	mode: SubagentMode;
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall")
					items.push({
						type: "toolCall",
						name: part.name,
						args: part.arguments,
					});
			}
		}
	}
	return items;
}

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

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description:
		'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
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
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description: "Prompt before running project-local agents. Default: true.",
			default: true,
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
	// Roster surfaced at registration time (research gap 2): the parent model sees
	// every agent by name + description in Available tools / Guidelines.
	const rosterAgents = discoverAgents(process.cwd(), "user").agents;
	const rosterLine =
		rosterAgents.map((a) => `${a.name} — ${a.description}`).join(" | ") ||
		"none";

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context windows (each runs in a separate pi process).",
			"Supported modes: single (agent + task) and parallel (tasks array, max 8, 4 concurrent).",
			`Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
			`To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").`,
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

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;
			const overrides = loadPersonaOverrides(ctx.cwd);
			const parentProvider = ctx.model?.provider;

			const requestedModes = getRequestedModes(params);
			const hasTasks = requestedModes.includes("parallel");
			const modeCount = requestedModes.length;

			const makeDetails =
				(mode: SubagentMode) =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			if (modeCount !== 1) {
				const available =
					agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			if (
				(agentScope === "project" || agentScope === "both") &&
				confirmProjectAgents &&
				ctx.hasUI
			) {
				const requestedAgentNames = new Set<string>();
				if (params.tasks)
					for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [
								{
									type: "text",
									text: "Canceled: project-local agents not approved.",
								},
							],
							details: makeDetails(hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			const runRequestedAgent = (
				agentName: string,
				task: string,
				cwd: string | undefined,
				onUpdate: RunSingleAgentOptions["onUpdate"],
			): Promise<SingleResult> => {
				const resolution = resolveSpawnContext({
					defaultCwd: ctx.cwd,
					agents,
					agentName,
					task,
					cwd,
					overrides,
					parentProvider,
				});
				if ("result" in resolution) {
					return Promise.resolve(resolution.result);
				}
				return runSingleAgent({
					context: resolution.context,
					signal,
					onUpdate,
				});
			};

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > 8)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is 8.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				const allResults: SingleResult[] = new Array(params.tasks.length);
				for (let i = 0; i < params.tasks.length; i++) {
					const t = params.tasks[i];
					if (!t) break;
					allResults[i] = {
						agent: t.agent,
						agentSource: "unknown",
						task: t.task,
						exitCode: -1, // -1 = still running
						messages: [],
						stderr: "",
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

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{
									type: "text",
									text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
								},
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(
					params.tasks,
					4,
					async (t, index) => {
						const result = await runRequestedAgent(
							t.agent,
							t.task,
							t.cwd,
							(partial) => {
								if (partial.details?.results[0]) {
									allResults[index] = partial.details.results[0];
									emitParallelUpdate();
								}
							},
						);
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);

				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					return `### [${r.agent}] ${status}\n\n${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const result = await runRequestedAgent(
					params.agent,
					params.task,
					params.cwd,
					onUpdate,
				);
				if (isFailedResult(result)) {
					const errorMsg = getResultOutput(result);
					return {
						content: [
							{
								type: "text",
								text: `Agent ${result.stopReason || "failed"}: ${errorMsg}`,
							},
						],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text",
							text: getFinalOutput(result.messages) || "(no output)",
						},
					],
					details: makeDetails("single")([result]),
				};
			}

			const available =
				agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [
					{
						type: "text",
						text: `Invalid parameters. Available agents: ${available}`,
					},
				],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview =
						t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3)
					text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task
				? args.task.length > 60
					? `${args.task.slice(0, 60)}...`
					: args.task
				: "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(
					text?.type === "text" ? text.text : "(no output)",
					0,
					0,
				);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped =
					limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0)
					text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded
							? item.text
							: item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0]!;
				const isError = isFailedResult(r);
				const icon = isError
					? theme.fg("error", "✗")
					: theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason)
						header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(
							new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
						);
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(
						new Text(theme.fg("muted", "─── Output ───"), 0, 0),
					);
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(
							new Text(theme.fg("muted", "(no output)"), 0, 0),
						);
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") +
											formatToolCall(
												item.name,
												item.args,
												theme.fg.bind(theme),
											),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(
								new Markdown(finalOutput.trim(), 0, 0, mdTheme),
							);
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason)
					text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage)
					text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0)
					text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT)
						text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					turns: 0,
				};
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter(
					(r) => r.exitCode !== -1 && !isFailedResult(r),
				).length;
				const failCount = details.results.filter(
					(r) => r.exitCode !== -1 && isFailedResult(r),
				).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = isFailedResult(r)
							? theme.fg("error", "✗")
							: theme.fg("success", "✓");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(
							new Text(
								theme.fg("muted", "Task: ") + theme.fg("dim", r.task),
								0,
								0,
							),
						);

						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") +
											formatToolCall(
												item.name,
												item.args,
												theme.fg.bind(theme),
											),
										0,
										0,
									),
								);
							}
						}

						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(
								new Markdown(finalOutput.trim(), 0, 0, mdTheme),
							);
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage)
							container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(
							new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0),
						);
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: isFailedResult(r)
								? theme.fg("error", "✗")
								: theme.fg("success", "✓");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});

	// ── Background command (research gap 1) ─────────────────────────────────────
	// /subagent-bg spawns a detached `pi --mode rpc` child. The parent keeps
	// working; when the child settles, the final output is injected into the
	// session via sendUserMessage. Session dir is printed for resumability.
	pi.registerCommand("subagent-bg", {
		description:
			"Spawn a detached background subagent (default agent: general). Usage: /subagent-bg [agent:<name>] <brief>. Results are injected when the subagent settles.",
		handler: async (args, ctx) => {
			const task = args.trim();
			if (!task) {
				ctx.ui.notify(
					"/subagent-bg needs a brief: /subagent-bg [agent:<name>] <brief>",
					"error",
				);
				return;
			}

			// Optional leading "agent:<name>" prefix (single- or multi-line); default general.
			let agentName = "general";
			let brief = task;
			const agentMatch = task.match(/^agent:(\S+)\s+([\s\S]*)$/);
			if (agentMatch) {
				const matchedName = agentMatch[1];
				const matchedBrief = agentMatch[2];
				if (matchedName) agentName = matchedName;
				brief = (matchedBrief ?? "").trim() || task;
			}

			const agents = discoverAgents(ctx.cwd, "user").agents;
			const resolvedName = agentName.trim().toLowerCase();
			const agent = agents.find((a) => a.name === resolvedName);
			if (!agent) {
				const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
				ctx.ui.notify(
					`Unknown agent "${agentName}". Available: ${available}`,
					"error",
				);
				return;
			}

			const overrides = loadPersonaOverrides(ctx.cwd);
			const parentProvider = ctx.model?.provider;
			const piApi = pi;

			const handle = spawnBackgroundAgent({
				context: createSpawnContext({
					agent,
					task: brief,
					cwd: ctx.cwd,
					overrides,
					parentProvider,
				}),
				onSettled: ({ finalOutput, sessionDir }) => {
					const summary = finalOutput.trim() || "(no text output)";
					const message =
						`Background subagent "${agent.name}" settled (session: ${sessionDir}).\n\n` +
						`${summary.length > 4000 ? summary.slice(0, 4000) + "\n…(truncated)" : summary}`;
					piApi.sendUserMessage(message, { deliverAs: "followUp" });
					ctx.ui.notify(`Background subagent "${agent.name}" settled`, "info");
				},
				onError: (error) => {
					piApi.sendUserMessage(
						`Background subagent "${agent.name}" failed: ${error}`,
						{
							deliverAs: "followUp",
						},
					);
					ctx.ui.notify(
						`Background subagent "${agent.name}" failed: ${error}`,
						"error",
					);
				},
			});

			ctx.ui.notify(
				`Background subagent "${handle.agent}" started (session dir: ${handle.sessionDir}). ` +
					"You'll be notified when it settles; resume with pi --session-dir <dir> --resume.",
				"info",
			);
		},
	});
}
