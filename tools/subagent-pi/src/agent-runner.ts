import {
	classifyError,
	OpenCodeGoUsageClient,
	RoutingMetrics,
	type UsageResult,
} from "opencode-go-usage";
import type { Launcher } from "./launcher.ts";
import { chooseQuotaRoute, type QuotaRoutingPolicy } from "./quota-routing.ts";
import { isFailedResult, runSingleAgent } from "./run.ts";
import type { SingleResult } from "./types.ts";

export const DEFAULT_QUOTA_POLICY: QuotaRoutingPolicy = {
	fallbackAtPercent: 75,
	fallbackAgents: new Set(["explore", "general"]),
};

export interface AgentRunnerDeps {
	launcher: Launcher;
	signal?: AbortSignal | undefined;
	usageClient?: OpenCodeGoUsageClient | undefined;
	metrics?: RoutingMetrics | undefined;
}

export interface AgentRunner {
	run(
		agentName: string,
		task: string,
		onUpdate: (partial: SingleResult) => void,
		cwd?: string,
		allowFallback?: boolean,
		timeoutMs?: number,
	): Promise<SingleResult>;
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

export function createAgentRunner(deps: AgentRunnerDeps): AgentRunner {
	const { launcher, signal, usageClient, metrics } = deps;

	return {
		async run(
			agentName,
			task,
			onUpdate,
			cwd,
			allowFallback = false,
			timeoutMs,
		) {
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
					onUpdate(partial) {
						const [result] = partial.details.results;
						if (result) {
							onUpdate(result);
						}
					},
					timeoutMs,
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
		},
	};
}
