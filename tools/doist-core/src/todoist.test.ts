import * as undici from "undici";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMockApiFilter,
	createMockApiLabel,
	createMockApiProject,
	createMockApiSection,
	createMockApiTask,
	createMockSyncResponse,
	interceptSync,
} from "./test-helpers/api-mocks.ts";
import { TASK_ALPHA, TASK_IDS } from "./test-helpers/fixtures.ts";
import { createClient, resolveCreated, type AllData } from "./todoist.ts";

// ── MockAgent setup ───────────────────────────────────────────────────────────

const mockAgent = new undici.MockAgent();
mockAgent.disableNetConnect();
undici.setGlobalDispatcher(mockAgent);

afterEach(() => {
	mockAgent.assertNoPendingInterceptors();
});

// ── sync ──────────────────────────────────────────────────────────────────

describe("createClient.sync", () => {
	it("returns parsed projects, sections, labels, and tasks", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				projects: [createMockApiProject()],
				sections: [createMockApiSection()],
				labels: [createMockApiLabel()],
				items: [createMockApiTask()],
			}),
		);

		const client = createClient("mytoken");
		const data = await client.sync("*");

		expect(data.projects).toHaveLength(1);
		expect(data.projects[0]?.id).toBe("p1");
		expect(data.sections).toHaveLength(1);
		expect(data.labels).toHaveLength(1);
		expect(data.tasks).toHaveLength(1);
		expect(data.tasks[0]?.content).toBe("Write tests");
		expect(data.syncToken).toBe("tok");
	});

	it("separates deleted items into deletedTaskIds", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				items: [
					createMockApiTask({ id: "t1" }),
					createMockApiTask({ id: "t2", is_deleted: true }),
				],
			}),
		);

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks.map((t) => t.id)).toEqual(["t1"]);
		expect(data.deletedTaskIds).toEqual(["t2"]);
	});

	it("filters out deleted and archived projects", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				projects: [
					createMockApiProject({ id: "p1" }),
					createMockApiProject({ id: "p2", is_deleted: true }),
					createMockApiProject({ id: "p3", is_archived: true }),
				],
			}),
		);

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.projects.map((p) => p.id)).toEqual(["p1"]);
	});

	it("stores labels as a JSON string in tasks", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				items: [createMockApiTask({ labels: ["work", "urgent"] })],
			}),
		);

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks[0]?.labels).toBe(JSON.stringify(["work", "urgent"]));
	});

	it("maps due date fields to due_date and due_string", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				items: [
					createMockApiTask({ due: { date: "2026-05-15", string: "May 15" } }),
				],
			}),
		);

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks[0]?.due_date).toBe("2026-05-15");
		expect(data.tasks[0]?.due_string).toBe("May 15");
	});

	it("parses filters from sync response", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				filters: [
					createMockApiFilter({
						id: "f1",
						name: "Today",
						query: "today",
						color: "blue",
						item_order: 1,
						is_favorite: true,
					}),
					createMockApiFilter({
						id: "f2",
						name: "High Priority",
						query: "priority 1",
						color: null,
						item_order: 0,
					}),
				],
			}),
		);

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.filters).toHaveLength(2);
		expect(data.filters[0]).toEqual({
			id: "f1",
			name: "Today",
			query: "today",
			color: "blue",
			item_order: 1,
			is_favorite: 1,
			synced_at: expect.any(String) as unknown,
		});
		expect(data.filters[1]).toEqual({
			id: "f2",
			name: "High Priority",
			query: "priority 1",
			color: null,
			item_order: 0,
			is_favorite: 0,
			synced_at: expect.any(String) as unknown,
		});
	});

	it("excludes deleted filters from sync response", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				filters: [
					createMockApiFilter({ id: "f1", name: "Active" }),
					createMockApiFilter({ id: "f2", name: "Deleted", is_deleted: true }),
				],
			}),
		);

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.filters).toHaveLength(1);
		expect(data.filters[0]?.id).toBe("f1");
	});

	it("returns empty filters array when no filters in response", async () => {
		interceptSync(mockAgent, createMockSyncResponse({ sync_token: "tok" }));

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.filters).toEqual([]);
	});
});

// ── resolveCreated ────────────────────────────────────────────────────────────

function makeAllData(overrides: Partial<AllData> = {}): AllData {
	return {
		projects: [],
		sections: [],
		labels: [],
		filters: [],
		tasks: [],
		completedTaskIds: [],
		deletedTaskIds: [],
		syncToken: "tok",
		...overrides,
	};
}

describe("resolveCreated", () => {
	it("returns the task matching the temp id mapping", () => {
		const data = makeAllData({
			tasks: [TASK_ALPHA],
			tempIdMapping: { "temp-123": TASK_IDS.alpha },
		});
		const task = resolveCreated(data, "temp-123");
		expect(task.id).toBe(TASK_IDS.alpha);
	});

	it("throws when temp id is not in the mapping", () => {
		const data = makeAllData({ tempIdMapping: {} });
		expect(() => resolveCreated(data, "temp-123")).toThrow(
			"failed to create task: no id returned",
		);
	});

	it("throws when temp id mapping is absent", () => {
		const data = makeAllData();
		expect(() => resolveCreated(data, "temp-123")).toThrow(
			"failed to create task: no id returned",
		);
	});

	it("throws when the resolved task is not in the response", () => {
		const data = makeAllData({
			tasks: [],
			tempIdMapping: { "temp-123": TASK_IDS.alpha },
		});
		expect(() => resolveCreated(data, "temp-123")).toThrow(
			`created task ${TASK_IDS.alpha} not in sync response`,
		);
	});
});
