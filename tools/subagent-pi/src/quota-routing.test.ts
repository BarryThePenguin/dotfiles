import { describe, expect, it } from "vitest";
import type { UsageResult } from "opencode-go-usage";
import { chooseQuotaRoute, type QuotaRoutingPolicy } from "./quota-routing.ts";
import type { SpawnContext } from "./run.ts";

const context: SpawnContext = {
	agent: {
		name: "explore",
		description: "explore",
		systemPrompt: "Explore",
		source: "user",
		filePath: "/agents/explore.md",
	},
	task: "inspect",
	cwd: "/repo",
	effective: {
		provider: "opencode-go",
		model: "deepseek-v4-flash",
		fallback: { provider: "opencode", model: "big-pickle" },
	},
};

const usage: UsageResult = {
	usage: {
		rolling: { percent: 12, resetsAt: "2026-01-02T00:00:00Z" },
		weekly: { percent: 81, resetsAt: "2026-01-03T00:00:00Z" },
		monthly: { percent: 35, resetsAt: "2026-02-01T00:00:00Z" },
	},
	fetchedAt: "2026-01-01T00:00:00Z",
	stale: false,
	source: "network",
};

const policy: QuotaRoutingPolicy = {
	fallbackAtPercent: 75,
	fallbackAgents: new Set(["explore", "general"]),
};

describe("chooseQuotaRoute", () => {
	it("uses the configured fallback for eligible agents at high usage", () => {
		const decision = chooseQuotaRoute(context, usage, policy);

		expect(decision.policy).toBe("fallback");
		expect(decision.context.effective).toMatchObject({
			provider: "opencode",
			model: "big-pickle",
		});
		expect(decision.reason).toContain("weekly");
	});

	it("leaves protected agents on their configured model", () => {
		const decision = chooseQuotaRoute(
			{ ...context, agent: { ...context.agent, name: "build" } },
			usage,
			policy,
		);

		expect(decision.policy).toBe("normal");
		expect(decision.context.effective.model).toBe("deepseek-v4-flash");
	});

	it("does not route when usage is unavailable", () => {
		const decision = chooseQuotaRoute(
			context,
			{ usage: null, stale: false, source: "none", error: "missing key" },
			policy,
		);

		expect(decision.policy).toBe("normal");
		expect(decision.reason).toContain("unavailable");
	});

	it("does not route on stale usage", () => {
		const decision = chooseQuotaRoute(
			context,
			{ ...usage, stale: true },
			policy,
		);

		expect(decision.policy).toBe("normal");
		expect(decision.reason).toContain("stale");
	});

	it("does not route a non-Go provider", () => {
		const decision = chooseQuotaRoute(
			{ ...context, effective: { ...context.effective, provider: "gpt" } },
			usage,
			policy,
		);

		expect(decision.policy).toBe("normal");
		expect(decision.reason).toContain("provider");
	});
});
