import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import type { Dispatcher, Interceptable } from "undici";
import { createClient } from "./todoist.ts";

// ── MockAgent setup ───────────────────────────────────────────────────────────

let savedDispatcher: Dispatcher;
let agent: MockAgent;
let pool: Interceptable;

const TODOIST_ORIGIN = "https://api.todoist.com";

beforeEach(() => {
	savedDispatcher = getGlobalDispatcher();
	agent = new MockAgent();
	agent.disableNetConnect();
	setGlobalDispatcher(agent);
	pool = agent.get(TODOIST_ORIGIN);
});

afterEach(async () => {
	await agent.close();
	setGlobalDispatcher(savedDispatcher);
});

// ── Wire-format helpers ───────────────────────────────────────────────────────

function apiItem(overrides: Record<string, unknown> = {}) {
	return {
		id: "t1",
		project_id: "p1",
		section_id: null,
		content: "Buy milk",
		description: "",
		priority: 1,
		due: null,
		labels: [],
		completed: false,
		added_at: null,
		is_deleted: false,
		...overrides,
	};
}

function apiProject(overrides: Record<string, unknown> = {}) {
	return {
		id: "p1",
		name: "Work",
		color: null,
		favorite: false,
		is_deleted: false,
		is_archived: false,
		...overrides,
	};
}

function apiSection(overrides: Record<string, unknown> = {}) {
	return {
		id: "s1",
		project_id: "p1",
		name: "Backlog",
		order: 1,
		is_deleted: false,
		...overrides,
	};
}

function apiLabel(overrides: Record<string, unknown> = {}) {
	return {
		id: "l1",
		name: "urgent",
		color: "red",
		is_deleted: false,
		...overrides,
	};
}

function interceptSync(
	body: unknown,
	times = 1,
) {
	for (let i = 0; i < times; i++) {
		pool
			.intercept({ path: "/api/v1/sync", method: "POST" })
			.reply(200, JSON.stringify(body), {
				headers: { "content-type": "application/json" },
			});
	}
}

// ── sync ──────────────────────────────────────────────────────────────────

describe("createClient.sync", () => {
	it("returns parsed projects, sections, labels, and tasks", async () => {
		interceptSync({
			sync_token: "tok",
			projects: [apiProject()],
			sections: [apiSection()],
			labels: [apiLabel()],
			items: [apiItem()],
		});

		const client = createClient("mytoken");
		const data = await client.sync("*");

		expect(data.projects).toHaveLength(1);
		expect(data.projects[0]?.id).toBe("p1");
		expect(data.sections).toHaveLength(1);
		expect(data.labels).toHaveLength(1);
		expect(data.tasks).toHaveLength(1);
		expect(data.tasks[0]?.content).toBe("Buy milk");
		expect(data.syncToken).toBe("tok");
	});

	it("separates deleted items into deletedTaskIds", async () => {
		interceptSync({
			sync_token: "tok",
			items: [apiItem({ id: "t1" }), apiItem({ id: "t2", is_deleted: true })],
		});

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks.map((t) => t.id)).toEqual(["t1"]);
		expect(data.deletedTaskIds).toEqual(["t2"]);
	});

	it("filters out deleted and archived projects", async () => {
		interceptSync({
			sync_token: "tok",
			projects: [
				apiProject({ id: "p1" }),
				apiProject({ id: "p2", is_deleted: true }),
				apiProject({ id: "p3", is_archived: true }),
			],
		});

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.projects.map((p) => p.id)).toEqual(["p1"]);
	});

	it("stores labels as a JSON string in tasks", async () => {
		interceptSync({
			sync_token: "tok",
			items: [apiItem({ labels: ["work", "urgent"] })],
		});

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks[0]?.labels).toBe(JSON.stringify(["work", "urgent"]));
	});

	it("maps due date fields to due_date and due_string", async () => {
		interceptSync({
			sync_token: "tok",
			items: [apiItem({ due: { date: "2026-05-15", string: "May 15" } })],
		});

		const client = createClient("mytoken");
		const data = await client.sync();

		expect(data.tasks[0]?.due_date).toBe("2026-05-15");
		expect(data.tasks[0]?.due_string).toBe("May 15");
	});
});

// ── completeTask ──────────────────────────────────────────────────────────────

describe("createClient.completeTask", () => {
	it("returns the new sync token on success", async () => {
		interceptSync({ sync_token: "tok", sync_status: { "any-uuid": "ok" } });

		const client = createClient("mytoken");
		await expect(client.completeTask("t1", null)).resolves.toMatchObject({ syncToken: "tok" });
	});
});

// ── updateTask ────────────────────────────────────────────────────────────────

describe("createClient.updateTask", () => {
	it("returns the updated task and new sync token", async () => {
		interceptSync({
			sync_token: "tok",
			sync_status: { "any-uuid": "ok" },
			items: [apiItem({ id: "t1", content: "Updated title", priority: 3 })],
		});

		const client = createClient("mytoken");
		const { task, syncToken } = await client.updateTask("t1", { title: "Updated title", priority: 3 }, null);

		expect(task.id).toBe("t1");
		expect(task.content).toBe("Updated title");
		expect(task.priority).toBe(3);
		expect(syncToken).toBe("tok");
	});

	it("throws when the updated task is not in the response", async () => {
		interceptSync({ sync_token: "tok", items: [] });

		const client = createClient("mytoken");
		await expect(client.updateTask("t1", {}, null)).rejects.toThrow("t1 not found after update");
	});
});

// ── addTask ───────────────────────────────────────────────────────────────────

describe("createClient.addTask", () => {
	it("returns the created task using temp_id mapping", async () => {
		// Reply dynamically to capture the temp_id from the request body
		pool
			.intercept({ path: "/api/v1/sync", method: "POST" })
			.reply(200, ({ body }) => {
				const params = new URLSearchParams(body as string);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{ temp_id?: string }>;
				const tempId = commands[0]?.temp_id ?? "";
				return JSON.stringify({
					sync_token: "tok",
					temp_id_mapping: { [tempId]: "t-real" },
					items: [apiItem({ id: "t-real", content: "New task" })],
				});
			}, { headers: { "content-type": "application/json" } });

		const client = createClient("mytoken");
		const { task, syncToken } = await client.addTask({ title: "New task" }, null);

		expect(task.id).toBe("t-real");
		expect(task.content).toBe("New task");
		expect(syncToken).toBe("tok");
	});

	it("throws when no id is returned in temp_id_mapping", async () => {
		interceptSync({ sync_token: "tok", temp_id_mapping: {}, items: [] });

		const client = createClient("mytoken");
		await expect(client.addTask({ title: "Task" }, null)).rejects.toThrow("failed to create task");
	});
});
