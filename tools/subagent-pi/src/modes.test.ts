import { describe, expect, it } from "vitest";
import { getRequestedModes, SUPPORTED_MODES } from "./modes.ts";

describe("subagent execution modes", () => {
	it("exposes only the contracted single and parallel modes", () => {
		expect(SUPPORTED_MODES).toEqual(["single", "parallel"]);
	});

	it("recognizes single-agent delegation", () => {
		expect(
			getRequestedModes({ agent: "general", task: "Review this" }),
		).toEqual(["single"]);
	});

	it("recognizes parallel delegation", () => {
		expect(
			getRequestedModes({ tasks: [{ agent: "general", task: "Review this" }] }),
		).toEqual(["parallel"]);
	});

	it("rejects calls that do not select exactly one supported mode", () => {
		expect(getRequestedModes({})).toEqual([]);
		expect(
			getRequestedModes({
				agent: "general",
				task: "Review this",
				tasks: [{ agent: "explore", task: "Also review this" }],
			}),
		).toEqual(["single", "parallel"]);
	});
});
