import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDefaultHarness,
	TASK_A,
	TASK_B,
} from "../test-helpers/server.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

describe("todoist_triage_analysis", () => {
	it("returns all four analysis categories", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_triage_analysis",
		});
		expect(structuredContent).toHaveProperty("duplicates.groups", []);
		expect(structuredContent).toHaveProperty("stale.candidates", []);
		expect(structuredContent).toHaveProperty("unroutedInbox", []);
		expect(structuredContent).toHaveProperty(
			"missingEnergyMetadata",
			expect.objectContaining({ length: 1 }),
		);
		expect(structuredContent).toHaveProperty("requiresAttention", true);
		expect(structuredContent).toHaveProperty("sync");
	});

	it("sets requiresAttention true when duplicates exist", async () => {
		harness.container.db.upsertTask({
			...TASK_A,
			id: "t3",
			content: "Alpha task",
		});
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_triage_analysis",
		});
		expect(structuredContent).toHaveProperty("requiresAttention", true);
		expect(structuredContent).toHaveProperty(
			"duplicates.groups",
			expect.objectContaining({ length: 1 }),
		);
	});

	it("can sync first when requested", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_triage_analysis",
			arguments: {
				sync: true,
			},
		});
		expect(structuredContent).toHaveProperty("sync", {
			filters: 0,
			labels: 1,
			projects: 2,
			reconciled: 0,
			sections: 1,
			tasks: 2,
		});
	});
});

describe("todoist_find_duplicates", () => {
	it("groups exact and fuzzy duplicate candidates", async () => {
		harness.container.db.upsertTask({
			...TASK_A,
			id: "t3",
			content: "Alpha task",
		});
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_find_duplicates",
		});
		expect(structuredContent).toHaveProperty(
			"groups",
			expect.arrayContaining([
				expect.objectContaining({
					canonicalTask: expect.objectContaining({
						id: expect.any(String) as unknown,
					}) as unknown,
					matches: expect.any(Array) as unknown,
					matchType: expect.stringMatching(/^(exact|fuzzy)$/) as unknown,
					score: expect.any(Number) as unknown,
					recommendationCode: expect.stringMatching(
						/^(merge|review|ignore)$/,
					) as unknown,
				}),
			]),
		);
	});

	it("can sync first when requested", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_find_duplicates",
			arguments: {
				sync: true,
			},
		});
		expect(structuredContent).toHaveProperty("sync", {
			filters: 0,
			labels: 1,
			projects: 2,
			reconciled: 0,
			sections: 1,
			tasks: 2,
		});
	});
});

describe("todoist_find_stale_tasks", () => {
	it("finds stale active tasks using multiple signals", async () => {
		harness.container.db.upsertTask({
			...TASK_B,
			id: "t4",
			content: "Old task",
			updated_at: "2020-01-01T00:00:00.000Z",
		});
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_find_stale_tasks",
		});
		expect(structuredContent).toHaveProperty(
			"candidates",
			expect.arrayContaining([
				expect.objectContaining({
					task: expect.objectContaining({
						id: expect.any(String) as unknown,
					}) as unknown,
					signals: expect.any(Array) as unknown,
					score: expect.any(Number) as unknown,
					recommendationCode: expect.stringMatching(
						/^(complete|rewrite|reschedule|schedule|keep)$/,
					) as unknown,
				}),
			]),
		);
	});

	it("can sync first when requested", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_find_stale_tasks",
			arguments: {
				sync: true,
			},
		});
		expect(structuredContent).toHaveProperty("sync", {
			filters: 0,
			labels: 1,
			projects: 2,
			reconciled: 0,
			sections: 1,
			tasks: 2,
		});
	});
});
