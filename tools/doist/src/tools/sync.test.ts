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
		const result = (await harness.client.callTool("todoist_sync")) as {
			projects: number;
			sections: number;
			labels: number;
			tasks: number;
			reconciled: number;
		};
		expect(result.projects).toBeGreaterThanOrEqual(0);
		expect(result.tasks).toBeGreaterThanOrEqual(0);
	});

	it("does not expose updatedTaskIds in output", async () => {
		const result = (await harness.client.callTool("todoist_sync")) as Record<string, unknown>;
		expect(Object.keys(result)).not.toContain("updatedTaskIds");
	});
});
