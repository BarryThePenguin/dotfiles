import type { UsageResult } from "opencode-go-usage";
import type { SpawnContext } from "./run.ts";

export interface QuotaRoutingPolicy {
	fallbackAtPercent: number;
	fallbackAgents: ReadonlySet<string>;
}

export type QuotaRoutingDecision = {
	context: SpawnContext;
	policy: "normal" | "fallback";
	reason: string;
};

/**
 * Selects a configured fallback only for opted-in low-stakes agents running on
 * OpenCode Go. Usage failures deliberately preserve the requested route.
 */
export function chooseQuotaRoute(
	context: SpawnContext,
	usage: UsageResult,
	policy: QuotaRoutingPolicy,
): QuotaRoutingDecision {
	if (!usage.usage) {
		return normal(context, "usage unavailable");
	}

	if (usage.stale) {
		return normal(context, "usage is stale");
	}

	if (context.effective.provider !== "opencode-go") {
		return normal(context, "provider is not opencode-go");
	}

	if (!policy.fallbackAgents.has(context.agent.name)) {
		return normal(context, "agent is protected from automatic fallback");
	}

	const windows = [
		["rolling", usage.usage.rolling.percent],
		["weekly", usage.usage.weekly.percent],
		["monthly", usage.usage.monthly.percent],
	] as const;
	const highest = windows.reduce((winner, current) =>
		current[1] > winner[1] ? current : winner,
	);

	if (highest[1] < policy.fallbackAtPercent) {
		return normal(
			context,
			`${highest[0]} usage ${highest[1]}% is below ${policy.fallbackAtPercent}%`,
		);
	}

	const fallback = context.effective.fallback;
	if (!fallback?.provider && !fallback?.model) {
		return normal(context, "no quota fallback configured");
	}

	return {
		context: {
			...context,
			effective: {
				...context.effective,
				...(fallback.provider ? { provider: fallback.provider } : {}),
				...(fallback.model ? { model: fallback.model } : {}),
			},
		},
		policy: "fallback",
		reason: `${highest[0]} usage ${highest[1]}% reached ${policy.fallbackAtPercent}% threshold`,
	};
}

function normal(context: SpawnContext, reason: string): QuotaRoutingDecision {
	return { context, policy: "normal", reason };
}
