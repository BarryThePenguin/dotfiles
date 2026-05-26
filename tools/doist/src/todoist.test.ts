import { afterEach, describe, it, expect } from "vitest";
import * as undici from "undici";
import { createClient } from "./todoist.ts";
import {
	createMockApiTask,
	createMockApiProject,
	createMockApiSection,
	createMockApiLabel,
	createMockSyncResponse,
	interceptSync,
	interceptSyncDynamic,
} from "./test-helpers/api-mocks.ts";

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
		interceptSync(mockAgent, createMockSyncResponse({
			sync_token: "tok",
			projects: [createMockApiProject()],
			sections: [createMockApiSection()],
			labels: [createMockApiLabel()],
			items: [createMockApiTask()],
		}));

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
		interceptSync(mockAgent, createMockSyncResponse({
			sync_token: "tok",
			items: [createMockApiTask({ id: "t1" }), createMockApiTask({ id: "t2", is_deleted: true })],
		}));

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks.map((t) => t.id)).toEqual(["t1"]);
		expect(data.deletedTaskIds).toEqual(["t2"]);
	});

	it("filters out deleted and archived projects", async () => {
		interceptSync(mockAgent, createMockSyncResponse({
			sync_token: "tok",
			projects: [
				createMockApiProject({ id: "p1" }),
				createMockApiProject({ id: "p2", is_deleted: true }),
				createMockApiProject({ id: "p3", is_archived: true }),
			],
		}));

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.projects.map((p) => p.id)).toEqual(["p1"]);
	});

	it("stores labels as a JSON string in tasks", async () => {
		interceptSync(mockAgent, createMockSyncResponse({
			sync_token: "tok",
			items: [createMockApiTask({ labels: ["work", "urgent"] })],
		}));

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks[0]?.labels).toBe(JSON.stringify(["work", "urgent"]));
	});

	it("maps due date fields to due_date and due_string", async () => {
		interceptSync(mockAgent, createMockSyncResponse({
			sync_token: "tok",
			items: [createMockApiTask({ due: { date: "2026-05-15", string: "May 15" } })],
		}));

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks[0]?.due_date).toBe("2026-05-15");
		expect(data.tasks[0]?.due_string).toBe("May 15");
	});
});

// ── completeTask ──────────────────────────────────────────────────────────────

describe("createClient.completeTask", () => {
	it("returns the new sync token on success", async () => {
		interceptSync(mockAgent, createMockSyncResponse({ sync_token: "tok", sync_status: { "any-uuid": "ok" } }));

		const client = createClient("mytoken");
		await expect(client.completeTask("t1", null)).resolves.toMatchObject({
			syncToken: "tok",
		});
	});
});

// ── updateTask ────────────────────────────────────────────────────────────────

describe("createClient.updateTask", () => {
	it("returns the updated task and new sync token", async () => {
		interceptSync(mockAgent, createMockSyncResponse({
			sync_token: "tok",
			sync_status: { "any-uuid": "ok" },
			items: [createMockApiTask({ id: "t1", content: "Updated title", priority: 3 })],
		}));

		const client = createClient("mytoken");
		const { task, syncToken } = await client.updateTask(
			"t1",
			{ title: "Updated title", priority: 3 },
			null,
		);

		expect(task.id).toBe("t1");
		expect(task.content).toBe("Updated title");
		expect(task.priority).toBe(3);
		expect(syncToken).toBe("tok");
	});

	it("throws when the updated task is not in the response", async () => {
		interceptSync(mockAgent, createMockSyncResponse({ sync_token: "tok", items: [] }));

		const client = createClient("mytoken");
		await expect(client.updateTask("t1", {}, null)).rejects.toThrow(
			"updated task t1 not in sync response",
		);
	});
});

// ── addTask ───────────────────────────────────────────────────────────────────

describe("createClient.addTask", () => {
	it("returns the created task using temp_id mapping", async () => {
		// Reply dynamically to capture the temp_id from the request body
		interceptSyncDynamic(mockAgent, (reqBody) => {
			const params = new URLSearchParams(reqBody);
			const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
				temp_id?: string;
			}>;
			const tempId = commands[0]?.temp_id ?? "";
			return {
				sync_token: "tok",
				temp_id_mapping: { [tempId]: "t-real" },
				items: [createMockApiTask({ id: "t-real", content: "New task" })],
			};
		});

		const client = createClient("mytoken");
		const { task, syncToken } = await client.addTask(
			{ title: "New task" },
			null,
		);

		expect(task.id).toBe("t-real");
		expect(task.content).toBe("New task");
		expect(syncToken).toBe("tok");
	});

	it("throws when no id is returned in temp_id_mapping", async () => {
		interceptSync(mockAgent, createMockSyncResponse({ sync_token: "tok", temp_id_mapping: {}, items: [] }));

		const client = createClient("mytoken");
		await expect(client.addTask({ title: "Task" }, null)).rejects.toThrow(
			"failed to create task",
		);
	});

	it("throws when the created task is not in the response", async () => {
		interceptSyncDynamic(mockAgent, (reqBody) => {
			const params = new URLSearchParams(reqBody);
			const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
				temp_id?: string;
			}>;
			const tempId = commands[0]?.temp_id ?? "";
			return {
				sync_token: "tok",
				temp_id_mapping: { [tempId]: "t-real" },
				items: [], // Empty items array: created task not in response
			};
		});

		const client = createClient("mytoken");
		await expect(client.addTask({ title: "Task" }, null)).rejects.toThrow(
			"created task t-real not in sync response",
		);
	});
});
