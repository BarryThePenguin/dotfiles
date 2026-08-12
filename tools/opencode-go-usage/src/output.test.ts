import { describe, expect, it } from "vitest";
import { formatUsage, isStrictFailure } from "./output.ts";

const fetchedAt = "2026-01-01T00:00:00.000Z";
const usage = {
	rolling: { percent: 12, resetsAt: "2026-01-01T00:30:00Z" },
	weekly: { percent: 8, resetsAt: "2026-01-02T00:00:00Z" },
	monthly: { percent: 35, resetsAt: "not-a-date" },
};

describe("formatUsage", () => {
	it("renders windows and relative reset times", () => {
		const result = formatUsage(
			{ usage, fetchedAt, stale: false, source: "network" },
			Date.parse(fetchedAt),
		);

		expect(result).toContain("OpenCode Go usage");
		expect(result).toContain("  rolling    12%  (resets in 30m)");
		expect(result).toContain("  weekly      8%  (resets in 24h)");
		expect(result).toContain("  monthly    35%  (resets not-a-date)");
		expect(result).toContain("fetched: 2026-01-01T00:00:00.000Z");
	});

	it("reports unavailable usage", () => {
		expect(
			formatUsage({
				usage: null,
				stale: false,
				source: "none",
				error: "missing key",
			}),
		).toBe("OpenCode Go usage unavailable: missing key");
	});
});

describe("isStrictFailure", () => {
	it("fails for unavailable, stale, or warned results", () => {
		expect(
			isStrictFailure({
				usage: null,
				stale: false,
				source: "none",
				error: "x",
			}),
		).toBe(true);
		expect(
			isStrictFailure({ usage, fetchedAt, stale: true, source: "cache" }),
		).toBe(true);
		expect(
			isStrictFailure({
				usage,
				fetchedAt,
				stale: false,
				source: "network",
				error: "warning",
			}),
		).toBe(true);
	});
});
