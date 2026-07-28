import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "doist-core";
import { createDefaultHarness } from "../test-helpers/server.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

describe("filters_query", () => {
	it("runs a query that is within the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_filters_query",
			arguments: { query: "today" },
		});
		expect(result.isError).toBeFalsy();
	});

	it("rejects a query one over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_filters_query",
			arguments: { query: "x".repeat(LIMITS.filterQuery + 1) },
		});
		expect(result.isError).toBe(true);
	});
});
