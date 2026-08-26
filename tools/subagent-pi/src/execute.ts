import { OpenCodeGoUsageClient, RoutingMetrics } from "opencode-go-usage";
import { createAgentRunner } from "./agent-runner.ts";
import type { SubagentDetails } from "./details.ts";
import { createLauncher, loadLauncherDeps } from "./launcher.ts";
import { getRequestedModes, type SubagentMode } from "./modes.ts";
import {
	MAX_PARALLEL_TASKS,
	PARALLEL_CONCURRENCY,
	ParallelRunLimitError,
	runParallelRun,
	type ParallelRunSnapshot,
	type ParallelRunTask,
} from "./parallel-run.ts";
import {
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	truncateOutput,
	type OnUpdate,
} from "./run.ts";
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

export async function executeSubagent(
	_toolCallId: string,
	params: SubagentExecuteParams,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdate | undefined,
	ctx: ExecuteContext,
	metrics?: RoutingMetrics,
): Promise<ExecuteResult> {
	const launcher = createLauncher(
		{ cwd: ctx.cwd, parentProvider: ctx.model?.provider },
		loadLauncherDeps(ctx.cwd),
	);
	const usageClient = metrics ? new OpenCodeGoUsageClient() : undefined;
	const runner = createAgentRunner({ launcher, signal, usageClient, metrics });

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
					runner.run(task.agent, task.task, onTaskUpdate, task.cwd, true),
				onUpdate: (nextSnapshot) => {
					onUpdate?.({
						content: [
							{
								type: "text",
								text: formatParallelProgress(nextSnapshot),
							},
						],
						details: makeParallelDetails(nextSnapshot),
					});
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
		const result = await runner.run(
			params.agent,
			params.task,
			(partial) => {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: getFinalOutput(partial.messages) || "(running...)",
						},
					],
					details: makeDetails("single")([partial]),
				});
			},
			params.cwd,
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
