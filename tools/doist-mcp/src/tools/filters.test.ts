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

describe("filters_add", () => {
	it("rejects a name over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_filters_add",
			arguments: { name: "x".repeat(LIMITS.filterName + 1), query: "today" },
		});
		expect(result.isError).toBe(true);
	});

	it("rejects a query over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_filters_add",
			arguments: { name: "test", query: "x".repeat(LIMITS.filterQuery + 1) },
		});
		expect(result.isError).toBe(true);
	});
});

describe("filters_update", () => {
	it("rejects a name over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_filters_update",
			arguments: { id: "1", name: "x".repeat(LIMITS.filterName + 1) },
		});
		expect(result.isError).toBe(true);
	});
});
