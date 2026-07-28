import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultHarness } from "../test-helpers/server.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

describe("sync", () => {
	it("fetches from todoist and returns counts", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_sync",
		});
		expect(structuredContent).toEqual({
			filters: 0,
			projects: 2,
			sections: 1,
			labels: 1,
			tasks: 2,
			reconciled: 0,
		});
	});

	it("does not expose updatedTaskIds in output", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_sync",
		});
		expect(structuredContent).not.toHaveProperty("updatedTaskIds");
	});
});
