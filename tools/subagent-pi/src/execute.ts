import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	classifyError,
	OpenCodeGoUsageClient,
	RoutingMetrics,
	type UsageResult,
} from "opencode-go-usage";
import { createLauncher, loadLauncherDeps } from "./launcher.ts";
import { chooseQuotaRoute, type QuotaRoutingPolicy } from "./quota-routing.ts";
import { getRequestedModes, type SubagentMode } from "./modes.ts";
import {
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	runSingleAgent,
	spawnBackgroundAgent,
	truncateOutput,
	type RunSingleAgentOptions,
} from "./run.ts";
import {
	MAX_PARALLEL_TASKS,
	PARALLEL_CONCURRENCY,
	ParallelRunLimitError,
	runParallelRun,
	type ParallelRunSnapshot,
	type ParallelRunTask,
} from "./parallel-run.ts";
import type { SubagentDetails } from "./details.ts";
import type { SingleResult } from "./types.ts";

export interface SubagentExecuteParams {
	agent?: string | undefined;
	task?: string | undefined;
	tasks?:
		| Array<{ agent: string; task: string; cwd?: string | undefined }>
		| undefined;
	cwd?: string | undefined;
}

interface ExecuteContext {
	cwd: string;
	model?: { provider?: string } | undefined;
}

type ExecuteResult = {
	content: Array<{ type: "text"; text: string }>;
	details: SubagentDetails;
	isError?: boolean;
};

function formatParallelProgress(snapshot: ParallelRunSnapshot): string {
	const { completed, failed, cancelled, queued, running } = snapshot.counts;
	const done = completed + failed + cancelled;
	const parts = [`${done}/${snapshot.entries.length} done`];
	if (running > 0) {
		parts.push(`${running} running`);
	}
	if (queued > 0) {
		parts.push(`${queued} queued`);
	}
	return `Parallel: ${parts.join(", ")}...`;
}

function usageFields(result: UsageResult) {
	if (!result.usage) {
		return { usageStale: result.stale };
	}
	return {
		rollingPercent: result.usage.rolling.percent,
		weeklyPercent: result.usage.weekly.percent,
		monthlyPercent: result.usage.monthly.percent,
		usageFetchedAt: result.fetchedAt,
		usageStale: result.stale,
	};
}

const DEFAULT_QUOTA_POLICY: QuotaRoutingPolicy = {
	fallbackAtPercent: 75,
	fallbackAgents: new Set(["explore", "general"]),
};

export async function executeSubagent(
	_toolCallId: string,
	params: SubagentExecuteParams,
	signal: AbortSignal | undefined,
	onUpdate: RunSingleAgentOptions["onUpdate"],
	ctx: ExecuteContext,
	metrics?: RoutingMetrics,
): Promise<ExecuteResult> {
	const launcher = createLauncher(
		{ cwd: ctx.cwd, parentProvider: ctx.model?.provider },
		loadLauncherDeps(ctx.cwd),
	);
	const usageClient = metrics ? new OpenCodeGoUsageClient() : undefined;

	const requestedModes = getRequestedModes(params);
	const modeCount = requestedModes.length;

	const makeDetails =
		(mode: SubagentMode) =>
		(results: SingleResult[]): SubagentDetails => ({
			mode,
			results,
		});
	const makeParallelDetails = (
		snapshot: ParallelRunSnapshot,
	): SubagentDetails => ({
		mode: "parallel",
		results: [],
		snapshot,
	});

	if (modeCount !== 1) {
		const available =
			launcher.agents.map((a) => `${a.name} (${a.source})`).join(", ") ||
			"none";
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

	const runRequestedAgent = async (
		agentName: string,
		task: string,
		cwd: string | undefined,
		onUpdate: RunSingleAgentOptions["onUpdate"],
		allowFallback = false,
	): Promise<SingleResult> => {
		const resolution = launcher.resolve(agentName, task, cwd);
		if ("result" in resolution) {
			return resolution.result;
		}

		const usage = usageClient ? await usageClient.get() : undefined;
		const decision =
			allowFallback && usage
				? chooseQuotaRoute(resolution.context, usage, DEFAULT_QUOTA_POLICY)
				: {
						context: resolution.context,
						policy: "normal" as const,
						reason: allowFallback
							? "usage unavailable"
							: "foreground invocation",
					};
		const startedAt = Date.now();
		try {
			const result = await runSingleAgent({
				context: decision.context,
				signal,
				onUpdate,
			});
			metrics?.record({
				occurredAt: new Date().toISOString(),
				agent: resolution.context.agent.name,
				provider: resolution.context.effective.provider,
				requestedModel: resolution.context.effective.model,
				selectedModel: result.model ?? decision.context.effective.model,
				policy: decision.policy,
				reason: decision.reason,
				...usageFields(
					usage ?? {
						usage: null,
						stale: false,
						source: "none",
						error: "not collected",
					},
				),
				outcome: isFailedResult(result) ? "failure" : "success",
				durationMs: Date.now() - startedAt,
				...(result.usage.input ? { inputTokens: result.usage.input } : {}),
				...(result.usage.output ? { outputTokens: result.usage.output } : {}),
				...(result.usage.cost ? { cost: result.usage.cost } : {}),
				...(isFailedResult(result)
					? {
							errorKind: classifyError(
								new Error(
									result.errorMessage ?? result.stopReason ?? result.stderr,
								),
							),
						}
					: {}),
			});
			return result;
		} catch (error) {
			metrics?.record({
				occurredAt: new Date().toISOString(),
				agent: resolution.context.agent.name,
				provider: resolution.context.effective.provider,
				requestedModel: resolution.context.effective.model,
				selectedModel: decision.context.effective.model,
				policy: decision.policy,
				reason: decision.reason,
				...usageFields(
					usage ?? {
						usage: null,
						stale: false,
						source: "none",
						error: "not collected",
					},
				),
				outcome: signal?.aborted ? "cancelled" : "failure",
				durationMs: Date.now() - startedAt,
				errorKind: classifyError(error),
			});
			throw error;
		}
	};

	if (params.tasks && params.tasks.length > 0) {
		const tasks: ParallelRunTask[] = params.tasks.map((task) => ({
			agent: task.agent,
			task: task.task,
			...(task.cwd ? { cwd: task.cwd } : {}),
		}));
		let snapshot: ParallelRunSnapshot;
		try {
			snapshot = await runParallelRun({
				tasks,
				maxTasks: MAX_PARALLEL_TASKS,
				concurrency: PARALLEL_CONCURRENCY,
				...(signal ? { signal } : {}),
				runTask: (task, onTaskUpdate) =>
					runRequestedAgent(
						task.agent,
						task.task,
						task.cwd,
						(partial) => {
							const result = partial.details.results[0];
							if (result) {
								onTaskUpdate(result);
							}
						},
						true,
					),
				onUpdate: (nextSnapshot) => {
					if (onUpdate) {
						onUpdate({
							content: [
								{
									type: "text",
									text: formatParallelProgress(nextSnapshot),
								},
							],
							details: makeParallelDetails(nextSnapshot),
						});
					}
				},
			});
		} catch (error) {
			if (!(error instanceof ParallelRunLimitError)) {
				throw error;
			}
			return {
				content: [{ type: "text", text: error.message }],
				details: makeDetails("parallel")([]),
			};
		}

		const summaries = snapshot.entries.map((entry) => {
			const result = entry.result;
			const output = result
				? truncateOutput(getResultOutput(result))
				: entry.status === "cancelled"
					? "(cancelled)"
					: "(no output)";
			const reason =
				result?.stopReason && result.stopReason !== "end"
					? ` (${result.stopReason})`
					: "";
			return `### [${entry.task.agent}] ${entry.status}${reason}\n\n${output}`;
		});
		const { completed, failed, cancelled } = snapshot.counts;
		const outcomeNote =
			failed || cancelled ? ` (${failed} failed, ${cancelled} cancelled)` : "";
		return {
			content: [
				{
					type: "text",
					text: `Parallel: ${completed}/${snapshot.entries.length} succeeded${outcomeNote}\n\n${summaries.join("\n\n---\n\n")}`,
				},
			],
			details: makeParallelDetails(snapshot),
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
		launcher.agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
	return {
		content: [
			{
				type: "text",
				text: `Invalid parameters. Available agents: ${available}`,
			},
		],
		details: makeDetails("single")([]),
	};
}

// ── Background command ──────────────────────────────────────────────────────

interface BackgroundCommandContext {
	cwd: string;
	model?: { provider?: string } | undefined;
	ui: {
		notify(message: string, level: "info" | "error" | "warning"): void;
	};
}

export function createBackgroundCommandHandler(pi: ExtensionAPI) {
	return async (args: string, ctx: BackgroundCommandContext): Promise<void> => {
		const task = args.trim();
		if (!task) {
			ctx.ui.notify(
				"/subagent-bg needs a brief: /subagent-bg [agent:<name>] <brief>",
				"error",
			);
			return;
		}

		let agentName = "general";
		let brief = task;
		const agentMatch = task.match(/^agent:(\S+)\s+([\s\S]*)$/);
		if (agentMatch) {
			const matchedName = agentMatch[1];
			const matchedBrief = agentMatch[2];
			if (matchedName) {
				agentName = matchedName;
			}
			brief = (matchedBrief ?? "").trim() || task;
		}

		const launcher = createLauncher(
			{ cwd: ctx.cwd, parentProvider: ctx.model?.provider },
			loadLauncherDeps(ctx.cwd),
		);
		const resolution = launcher.resolve(agentName, brief);
		if ("result" in resolution) {
			ctx.ui.notify(resolution.result.stderr, "error");
			return;
		}

		const { context } = resolution;
		const { agent } = context;
		const usage = await new OpenCodeGoUsageClient().get();
		const decision = chooseQuotaRoute(context, usage, DEFAULT_QUOTA_POLICY);
		const routedContext = decision.context;

		const handle = spawnBackgroundAgent({
			context: routedContext,
			onSettled: ({ finalOutput, sessionDir }) => {
				const summary = finalOutput.trim() || "(no text output)";
				const message =
					`Background subagent "${agent.name}" settled (session: ${sessionDir}).\n\n` +
					(summary.length > 4000
						? `${summary.slice(0, 4000)}\n…(truncated)`
						: summary);
				pi.sendUserMessage(message, { deliverAs: "followUp" });
				ctx.ui.notify(`Background subagent "${agent.name}" settled`, "info");
			},
			onError: (error) => {
				pi.sendUserMessage(
					`Background subagent "${agent.name}" failed: ${error}`,
					{ deliverAs: "followUp" },
				);
				ctx.ui.notify(
					`Background subagent "${agent.name}" failed: ${error}`,
					"error",
				);
			},
		});

		ctx.ui.notify(
			`Background subagent "${handle.agent}" started (session dir: ${handle.sessionDir}). ` +
				(decision.policy === "fallback"
					? `Using quota fallback (${decision.reason}). `
					: "") +
				"You'll be notified when it settles; resume with pi --session-dir <dir> --resume.",
			"info",
		);
	};
}
