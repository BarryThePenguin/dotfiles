import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultHarness, TASK_B, TODAY } from "../test-helpers/server.ts";

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
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_session_summary",
		});
		expect(structuredContent).toHaveProperty("today", [
			expect.objectContaining({ id: "t1" }),
		]);
		expect(structuredContent).toHaveProperty("thoughtsCount", 0);
		expect(structuredContent).toHaveProperty("requiresTriage", false);
		expect(structuredContent).toHaveProperty("suggested", []);
		expect(structuredContent).toHaveProperty("syncedAt", expect.any(String));
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
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_session_summary",
		});
		expect(structuredContent).toHaveProperty("overdue", expect.objectContaining({ length: 6 }));
		expect(structuredContent).toHaveProperty("requiresTriage", true);
	});

	it("returns energy-matched suggestions when energy is provided", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_session_summary",
			arguments: {
				energy: "low",
			},
		});
		expect(structuredContent).toHaveProperty("suggested", expect.any(Array));
	});

	it("returns empty suggestions when energy is omitted", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_session_summary",
		});
		expect(structuredContent).toHaveProperty("suggested", expect.arrayContaining([]));
	});

	it("can sync first when requested", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_session_summary",
			arguments: {
				sync: true,
			},
		});
		expect(structuredContent).toHaveProperty("syncedAt", expect.any(String));
	});
});
