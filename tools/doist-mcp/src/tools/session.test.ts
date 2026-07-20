import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createDefaultHarness,
	TASK_A,
	TASK_B,
	TODAY,
} from "../test-helpers/server.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

describe("todoist_session_summary", () => {
	it("returns overdue, today, and thoughts counts", async () => {
		const result = (await harness.client.callTool(
			"todoist_session_summary",
		)) as {
			overdue: unknown[];
			today: unknown[];
			thoughtsCount: number;
			requiresTriage: boolean;
			suggested: unknown[];
			syncedAt: string | null;
		};
		expect(result.today).toBeInstanceOf(Array);
		expect(result.today.length).toBeGreaterThan(0);
		expect(result.today[0]).toMatchObject({ id: "t1" });
		expect(typeof result.thoughtsCount).toBe("number");
		expect(typeof result.requiresTriage).toBe("boolean");
		expect(result.suggested).toBeInstanceOf(Array);
		expect(result.syncedAt).toEqual(expect.any(String));
	});

	it("requiresTriage is true when overdue > 5", async () => {
		for (let i = 0; i < 6; i++) {
			harness.container.db.upsertTask({
				...TASK_B,
				id: `overdue-${i}`,
				content: `Overdue task ${i}`,
				due_date: "2020-01-01",
				due_string: "Jan 1 2020",
				updated_at: TODAY,
			});
		}
		const result = (await harness.client.callTool(
			"todoist_session_summary",
		)) as {
			overdue: unknown[];
			requiresTriage: boolean;
		};
		expect(result.overdue.length).toBeGreaterThanOrEqual(6);
		expect(result.requiresTriage).toBe(true);
	});

	it("returns energy-matched suggestions when energy is provided", async () => {
		const result = (await harness.client.callTool("todoist_session_summary", {
			energy: "low",
		})) as {
			suggested: unknown[];
		};
		expect(result.suggested).toBeInstanceOf(Array);
	});

	it("returns empty suggestions when energy is omitted", async () => {
		const result = (await harness.client.callTool(
			"todoist_session_summary",
		)) as {
			suggested: unknown[];
		};
		expect(result.suggested).toHaveLength(0);
	});

	it("can sync first when requested", async () => {
		const result = (await harness.client.callTool("todoist_session_summary", {
			sync: true,
		})) as { sync: unknown };
		expect(result.sync).toBeDefined();
	});
});
