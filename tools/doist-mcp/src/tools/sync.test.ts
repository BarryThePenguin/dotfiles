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
		expect(result.projects).toBe(2);
		expect(result.sections).toBe(1);
		expect(result.labels).toBe(1);
		expect(result.tasks).toBe(2);
		expect(typeof result.reconciled).toBe("number");
	});

	it("does not expose updatedTaskIds in output", async () => {
		const result = (await harness.client.callTool("todoist_sync")) as Record<
			string,
			unknown
		>;
		expect(Object.keys(result)).not.toContain("updatedTaskIds");
	});
});
