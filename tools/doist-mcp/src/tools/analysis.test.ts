import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDefaultHarness,
	TASK_A,
	TASK_B,
	NOW,
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
		const result = (await harness.client.callTool(
			"todoist_triage_analysis",
		)) as {
			duplicates: { groups: unknown[] };
			stale: { candidates: unknown[] };
			unroutedInbox: unknown[];
			missingEnergyMetadata: unknown[];
			requiresAttention: boolean;
			recommendedStartCategory: string | null;
			syncedAt: string | null;
		};
		expect(result.duplicates).toBeDefined();
		expect(result.duplicates.groups).toBeInstanceOf(Array);
		expect(result.stale).toBeDefined();
		expect(result.stale.candidates).toBeInstanceOf(Array);
		expect(result.unroutedInbox).toBeInstanceOf(Array);
		expect(result.missingEnergyMetadata).toBeInstanceOf(Array);
		expect(typeof result.requiresAttention).toBe("boolean");
		expect(result.syncedAt).toEqual(expect.any(String));
	});

	it("sets requiresAttention true when duplicates exist", async () => {
		harness.container.db.upsertTask({
			...TASK_A,
			id: "t3",
			content: "Alpha task",
		});
		const result = (await harness.client.callTool(
			"todoist_triage_analysis",
		)) as {
			requiresAttention: boolean;
			duplicates: { groups: unknown[] };
		};
		expect(result.requiresAttention).toBe(true);
		expect(result.duplicates.groups.length).toBeGreaterThan(0);
	});

	it("can sync first when requested", async () => {
		const result = (await harness.client.callTool("todoist_triage_analysis", {
			sync: true,
		})) as { sync: unknown };
		expect(result.sync).toBeDefined();
	});
});

describe("todoist_find_duplicates", () => {
	it("groups exact and fuzzy duplicate candidates", async () => {
		harness.container.db.upsertTask({
			...TASK_A,
			id: "t3",
			content: "Alpha task",
		});
		const result = (await harness.client.callTool(
			"todoist_find_duplicates",
		)) as {
			groups: Array<{
				canonicalTask: { id: string; content: string };
				matches: unknown[];
				matchType: string;
				score: number;
				recommendationCode: string;
			}>;
		};
		expect(result.groups.length).toBeGreaterThan(0);
		expect(result.groups[0]).toMatchObject({
			canonicalTask: expect.objectContaining({ id: expect.any(String) }),
			matches: expect.any(Array),
			matchType: expect.stringMatching(/^(exact|fuzzy)$/),
			score: expect.any(Number),
			recommendationCode: expect.stringMatching(/^(merge|review|ignore)$/),
		});
	});

	it("can sync first when requested", async () => {
		const result = (await harness.client.callTool("todoist_find_duplicates", {
			sync: true,
		})) as { sync: unknown };
		expect(result.sync).toBeDefined();
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
		const result = (await harness.client.callTool(
			"todoist_find_stale_tasks",
		)) as {
			candidates: Array<{
				task: { id: string; content: string };
				signals: string[];
				score: number;
				recommendationCode: string;
			}>;
		};
		expect(result.candidates.length).toBeGreaterThanOrEqual(1);
		expect(result.candidates[0]).toMatchObject({
			task: expect.objectContaining({ id: expect.any(String) }),
			signals: expect.any(Array),
			score: expect.any(Number),
			recommendationCode: expect.stringMatching(
				/^(complete|rewrite|reschedule|schedule|keep)$/,
			),
		});
	});

	it("can sync first when requested", async () => {
		const result = (await harness.client.callTool("todoist_find_stale_tasks", {
			sync: true,
		})) as { sync: unknown };
		expect(result.sync).toBeDefined();
	});
});
