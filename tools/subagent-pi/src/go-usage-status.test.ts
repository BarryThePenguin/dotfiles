import { describe, expect, it } from "vitest";
import type { UsageResult } from "opencode-go-usage";
import { formatGoUsageStatus } from "./go-usage-status.ts";

const usage = {
	rolling: { percent: 12, resetsAt: "2026-01-02T00:00:00Z" },
	weekly: { percent: 8, resetsAt: "2026-01-03T00:00:00Z" },
	monthly: { percent: 35, resetsAt: "2026-02-01T00:00:00Z" },
};

function result(overrides: Partial<UsageResult> = {}): UsageResult {
	return {
		usage,
		fetchedAt: "2026-01-01T00:00:00Z",
		stale: false,
		source: "network",
		...overrides,
	} as UsageResult;
}

describe("formatGoUsageStatus", () => {
	it("shows rolling, weekly, and monthly usage", () => {
		expect(formatGoUsageStatus(result())).toEqual({
			text: "Go 12%r/8%w/35%m",
			color: "accent",
		});
	});

	it("uses warning and error colors at high usage", () => {
		expect(
			formatGoUsageStatus(
				result({
					usage: {
						...usage,
						monthly: { percent: 80, resetsAt: usage.monthly.resetsAt },
					},
				}),
			),
		).toMatchObject({ color: "warning" });
		expect(
			formatGoUsageStatus(
				result({
					usage: {
						...usage,
						weekly: { percent: 95, resetsAt: usage.weekly.resetsAt },
					},
				}),
			),
		).toMatchObject({ color: "error" });
	});

	it("marks stale and warning results without exposing the error", () => {
		expect(
			formatGoUsageStatus(result({ stale: true, error: "offline" })),
		).toMatchObject({ text: "Go 12%r/8%w/35%m?!" });
	});

	it("does not make missing credentials noisy", () => {
		expect(
			formatGoUsageStatus({
				usage: null,
				stale: false,
				source: "none",
				error: "missing key",
			}),
		).toEqual({ text: "Go --", color: "dim" });
	});
});
