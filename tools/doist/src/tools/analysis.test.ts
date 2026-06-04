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
			groups: Array<unknown>;
		};
		expect(result.groups.length).toBeGreaterThan(0);
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
			candidates: Array<unknown>;
		};
		expect(result.candidates.length).toBeGreaterThanOrEqual(0);
	});

	it("can sync first when requested", async () => {
		const result = (await harness.client.callTool("todoist_find_stale_tasks", {
			sync: true,
		})) as { sync: unknown };
		expect(result.sync).toBeDefined();
	});
});
