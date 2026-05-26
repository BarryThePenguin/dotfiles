import {
	LATEST_PROTOCOL_VERSION,
	McpServer,
	type JSONRPCMessage,
	type Transport,
} from "@modelcontextprotocol/server";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Container } from "./container.ts";
import { Database } from "./db.ts";
import { buildServer } from "./server.ts";
import { setToken } from "./sync-lifecycle.ts";
import { createTestContainer } from "./test-helpers/container.ts";
import type { TodoistClient } from "./todoist.ts";

// ── Fixtures ──────────────────────────────────────────────────────
const NOW = new Date().toISOString();
const TODAY = new Date().toISOString().slice(0, 10);

const PROJECT = {
	id: "p1",
	name: "Work",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

const SECTION = {
	id: "s1",
	project_id: "p1",
	name: "Backlog",
	order_: 1,
	synced_at: NOW,
};

const LABEL = { id: "l1", name: "urgent", color: "red", synced_at: NOW };

const TASK_A = {
	id: "t1",
	project_id: "p1",
	section_id: "s1",
	content: "Alpha task",
	description: null,
	priority: 1,
	due_date: TODAY,
	due_string: "today",
	labels: JSON.stringify(["urgent"]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

const TASK_B = {
	id: "t2",
	project_id: "p1",
	section_id: null,
	content: "Beta task",
	description: null,
	priority: 4,
	due_date: "2030-01-01",
	due_string: "Jan 1 2030",
	labels: JSON.stringify([]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

// ── InMemoryTransport ─────────────────────────────────────────────
class InMemoryTransport implements Transport {
	private _peer: InMemoryTransport | null = null;
	onmessage?: ((msg: JSONRPCMessage) => void) | undefined;
	onclose?: (() => void) | undefined;
	onerror?: ((err: Error) => void) | undefined;

	static pair(): [InMemoryTransport, InMemoryTransport] {
		const a = new InMemoryTransport();
		const b = new InMemoryTransport();
		a._peer = b;
		b._peer = a;
		return [a, b];
	}

	async start(): Promise<void> {}

	// eslint-disable-next-line @typescript-eslint/require-await
	async send(message: JSONRPCMessage): Promise<void> {
		this._peer?.onmessage?.(message);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	async close(): Promise<void> {
		this.onclose?.();
	}
}

// ── MCP client helper ─────────────────────────────────────────────
async function makeClient(server: McpServer) {
	const [clientTransport, serverTransport] = InMemoryTransport.pair();
	await server.connect(serverTransport);

	let nextId = 1;
	const pending = new Map<number, (msg: JSONRPCMessage) => void>();

	clientTransport.onmessage = (msg: JSONRPCMessage) => {
		if ("id" in msg && typeof msg.id === "number") {
			const resolve = pending.get(msg.id);
			resolve?.(msg);
			pending.delete(msg.id);
		}
	};

	function rpc(method: string, params?: object): Promise<JSONRPCMessage> {
		return new Promise((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			void clientTransport.send({
				jsonrpc: "2.0",
				id,
				method,
				params: params ?? {},
			} as JSONRPCMessage);
		});
	}

	function notify(method: string): void {
		void clientTransport.send({
			jsonrpc: "2.0",
			method,
			params: {},
		});
	}

	// MCP handshake
	await rpc("initialize", {
		protocolVersion: LATEST_PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: "test-client", version: "0.0.1" },
	});
	notify("notifications/initialized");

	async function callTool(
		name: string,
		args: Record<string, unknown> = {},
	): Promise<unknown> {
		const response = await rpc("tools/call", { name, arguments: args });
		const r = response as Record<string, unknown>;
		if ("error" in r && r["error"]) {
			const err = r["error"] as { message?: string };
			throw new Error(err.message ?? "rpc error");
		}
		const result = r["result"] as {
			content?: { text: string }[];
			isError?: boolean;
			structuredContent?: unknown;
		};
		if (result.isError) {
			throw new Error(result.content?.[0]?.text ?? "tool error");
		}
		// MCP tools can return structuredContent directly, or text to be parsed
		if (result.structuredContent !== undefined) {
			return result.structuredContent;
		}
		return JSON.parse(result.content?.[0]?.text ?? "null");
	}

	return { callTool, close: () => clientTransport.close() };
}

// ── Shared setup ──────────────────────────────────────────────────
let container: Container;
let tempDir: string;
let dbPath: string;
let rcPath: string;
let mockClient: TodoistClient;
let mcpClient: Awaited<ReturnType<typeof makeClient>>;
let destroyDb: () => void;

beforeEach(async () => {
	tempDir = mkdtempSync(join(tmpdir(), "doist-mcp-test-"));
	dbPath = join(tempDir, "test.db");
	rcPath = join(tempDir, ".doistrc");

	writeFileSync(
		rcPath,
		JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
	);
	process.env["TODOIST_DB_PATH"] = dbPath;
	process.env["TODOIST_RC_PATH"] = rcPath;
	process.env["TODOIST_API_TOKEN"] = "test-token";

	const db = new Database({
		dbPath,
		rcPath,
	});

	mockClient = {
		sync: vi.fn().mockResolvedValue({
			projects: [],
			sections: [],
			labels: [],
			tasks: [],
			deletedTaskIds: [],
			syncToken: "tok",
		}),
		completeTask: vi.fn().mockResolvedValue({ syncToken: "tok2" }),
		updateTask: vi.fn().mockResolvedValue({ task: TASK_A, syncToken: "tok2" }),
		addTask: vi.fn(),
	};

	container = createTestContainer({
		client: mockClient,
		database: db,
		rcDir: tempDir,
	});

	db.upsertProject(PROJECT);
	db.upsertSection(SECTION);
	db.upsertLabel(LABEL);
	db.upsertTask(TASK_A);
	db.upsertTask(TASK_B);
	setToken(db, "tok");

	const server = buildServer(container);
	destroyDb = () => {
		db.close();
	};
	mcpClient = await makeClient(server);
});

afterEach(async () => {
	await mcpClient.close();
	destroyDb();
	rmSync(tempDir, { recursive: true });
	delete process.env["TODOIST_DB_PATH"];
	delete process.env["TODOIST_RC_PATH"];
	delete process.env["TODOIST_API_TOKEN"];
});

// ── tasks_list ────────────────────────────────────────────────────
type TasksListResult = {
	syncedAt: string | null;
	tasks: { id: string; labels: unknown }[];
};
async function tasksList(args: Record<string, unknown> = {}) {
	return (await mcpClient.callTool(
		"todoist_tasks_list",
		args,
	)) as TasksListResult;
}

describe("tasks_list", () => {
	it("returns all incomplete tasks", async () => {
		const { tasks } = await tasksList();
		expect(tasks).toHaveLength(2);
		expect(tasks.map((t) => t.id)).toEqual(
			expect.arrayContaining(["t1", "t2"]),
		);
	});

	it("includes syncedAt in the response", async () => {
		const result = await tasksList();
		expect("syncedAt" in result).toBe(true);
	});

	it("filters by project", async () => {
		const { tasks } = await tasksList({ project: "p1" });
		expect(tasks).toHaveLength(2);
	});

	it("filters by due=today", async () => {
		const { tasks } = await tasksList({ due: "today" });
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.id).toBe("t1");
	});

	it("filters by priority", async () => {
		const { tasks } = await tasksList({ priority: 4 });
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.id).toBe("t2");
	});

	it("filters by label", async () => {
		const { tasks } = await tasksList({ label: "urgent" });
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.id).toBe("t1");
	});

	it("returns empty for unknown project", async () => {
		const { tasks } = await tasksList({ project: "p999" });
		expect(tasks).toHaveLength(0);
	});

	it("filters by project name as well as id", async () => {
		const { tasks } = await tasksList({ project: "Work" });
		expect(tasks).toHaveLength(2);
	});
});

// ── tasks_search ──────────────────────────────────────────────────
describe("tasks_search", () => {
	it("returns matching tasks as formatted objects", async () => {
		const result = await mcpClient.callTool("todoist_tasks_search", {
			query: "Alpha",
		});
		expect(result).toMatchObject({
			tasks: [{ id: "t1", labels: expect.any(Array) as unknown }],
		});
	});

	it("returns empty for no match", async () => {
		const result = await mcpClient.callTool("todoist_tasks_search", {
			query: "zzznomatch",
		});
		expect(result).toMatchObject({ tasks: [] });
	});
});

// ── tasks_get ─────────────────────────────────────────────────────
describe("tasks_get", () => {
	it("returns task by id", async () => {
		const task = await mcpClient.callTool("tasks_get", { id: "t1" });
		expect(task).toMatchObject({ content: "Alpha task" });
	});

	it("returns labels as an array, not a JSON string", async () => {
		const task = await mcpClient.callTool("tasks_get", { id: "t1" });
		expect(task).toMatchObject({ labels: ["urgent"] });
	});

	it("throws for unknown id", async () => {
		await expect(
			mcpClient.callTool("tasks_get", { id: "missing" }),
		).rejects.toThrow("task not found: missing");
	});
});

// ── projects_list ─────────────────────────────────────────────────
describe("projects_list", () => {
	it("returns all projects", async () => {
		const result = await mcpClient.callTool("todoist_projects_list");
		expect(result).toMatchObject({ projects: [{ name: "Work" }] });
	});
});

// ── labels_list ───────────────────────────────────────────────────
describe("labels_list", () => {
	it("returns all labels", async () => {
		const result = await mcpClient.callTool("todoist_labels_list");
		expect(result).toMatchObject({ labels: [{ name: "urgent" }] });
	});
});

// ── sections_list ─────────────────────────────────────────────────
describe("sections_list", () => {
	it("returns all sections", async () => {
		const result = await mcpClient.callTool("todoist_sections_list");
		expect(result).toMatchObject({ sections: [{ name: "Backlog" }] });
	});

	it("filters by project", async () => {
		const result = await mcpClient.callTool("todoist_sections_list", {
			project: "p1",
		});
		expect(result).toMatchObject({ sections: [{ name: "Backlog" }] });
	});

	it("returns empty for unknown project", async () => {
		const result = await mcpClient.callTool("todoist_sections_list", {
			project: "p999",
		});
		expect(result).toMatchObject({ sections: [] });
	});

	it("filters by project name as well as id", async () => {
		const result = await mcpClient.callTool("todoist_sections_list", {
			project: "Work",
		});
		expect(result).toMatchObject({ sections: [{ name: "Backlog" }] });
	});
});

// ── tasks_complete ────────────────────────────────────────────────
describe("tasks_complete", () => {
	it("calls completeTask and marks the row done in the db", async () => {
		vi.mocked(mockClient.sync).mockResolvedValueOnce({
			projects: [],
			sections: [],
			labels: [],
			tasks: [TASK_A], // Return unchanged task (no conflict)
			deletedTaskIds: [],
			syncToken: "tok",
			completedTaskIds: [],
		});

		vi.mocked(mockClient.completeTask).mockResolvedValueOnce({
			syncToken: "tok2",
		});

		const result = await mcpClient.callTool("todoist_tasks_complete", {
			id: "t1",
		});
		expect(result).toMatchObject({ id: "t1", completed: true });
		expect(mockClient.completeTask).toHaveBeenCalledWith("t1", "tok");

		const tempDb = new Database({ dbPath, rcPath });
		const row = tempDb.selectTaskById("t1");
		expect(row?.completed).toBe(true);
	});
});

// ── tasks_update ──────────────────────────────────────────────────
describe("tasks_update", () => {
	it("updates task title", async () => {
		vi.mocked(mockClient.sync).mockResolvedValueOnce({
			projects: [],
			sections: [],
			labels: [],
			tasks: [TASK_A], // Return unchanged task (no conflict)
			deletedTaskIds: [],
			syncToken: "tok",
			completedTaskIds: [],
		});

		vi.mocked(mockClient.updateTask).mockResolvedValue({
			task: { ...TASK_A, content: "Updated title" },
			syncToken: "tok2",
		});

		const result = await mcpClient.callTool("todoist_tasks_update", {
			id: "t1",
			title: "Updated title",
		});

		expect(mockClient.updateTask).toHaveBeenCalledWith(
			"t1",
			{
				title: "Updated title",
			},
			"tok",
		);
		expect(result).toMatchObject({ content: "Updated title" });
	});

	it("appends a new label to existing labels", async () => {
		vi.mocked(mockClient.sync).mockResolvedValueOnce({
			projects: [],
			sections: [],
			labels: [],
			tasks: [TASK_A], // Return unchanged task (no conflict)
			deletedTaskIds: [],
			syncToken: "tok",
			completedTaskIds: [],
		});

		await mcpClient.callTool("todoist_tasks_update", {
			id: "t1",
			addLabels: ["focus"],
		});

		expect(mockClient.updateTask).toHaveBeenCalledWith(
			"t1",
			expect.objectContaining({
				labels: expect.arrayContaining(["urgent", "focus"]) as unknown,
			}),
			"tok",
		);
	});

	it("does not duplicate an existing label", async () => {
		vi.mocked(mockClient.sync).mockResolvedValueOnce({
			projects: [],
			sections: [],
			labels: [],
			tasks: [TASK_A],
			deletedTaskIds: [],
			completedTaskIds: [],
			syncToken: "tok",
		});

		vi.mocked(mockClient.updateTask).mockResolvedValueOnce({
			task: { ...TASK_A, labels: JSON.stringify(["urgent"]) },
			syncToken: "tok",
		});

		await mcpClient.callTool("todoist_tasks_update", {
			id: "t1",
			addLabels: ["urgent"],
		});

		expect(mockClient.updateTask).toHaveBeenCalledWith(
			"t1",
			expect.objectContaining({
				labels: ["urgent"],
			}),
			"tok",
		);
	});

	it("passes sectionId when section is provided", async () => {
		vi.mocked(mockClient.sync).mockResolvedValueOnce({
			projects: [],
			sections: [],
			labels: [],
			tasks: [TASK_A],
			deletedTaskIds: [],
			completedTaskIds: [],
			syncToken: "tok",
		});

		vi.mocked(mockClient.updateTask).mockResolvedValueOnce({
			task: { ...TASK_A, section_id: "s2" },
			syncToken: "tok",
		});

		await mcpClient.callTool("todoist_tasks_update", {
			id: "t1",
			section: "s2",
		});

		expect(mockClient.updateTask).toHaveBeenCalledWith(
			"t1",
			expect.objectContaining({ sectionId: "s2" }),
			"tok",
		);
	});
});

// ── tasks_add ─────────────────────────────────────────────────────
describe("tasks_add", () => {
	const NEW_TASK = {
		id: "t-new",
		project_id: "p1",
		section_id: null,
		content: "New task",
		description: null,
		priority: 1,
		due_date: null,
		due_string: null,
		labels: JSON.stringify([]),
		is_completed: 0,
		created_at: NOW,
		synced_at: NOW,
	};

	it("creates a new task", async () => {
		vi.mocked(mockClient.addTask).mockResolvedValue({
			task: NEW_TASK,
			syncToken: "tok2",
		});

		const result = await mcpClient.callTool("todoist_tasks_add", {
			title: "New task",
		});

		expect(mockClient.addTask).toHaveBeenCalledWith(
			{ title: "New task" },
			"tok",
		);
		expect(result).toMatchObject({ id: "t-new", content: "New task" });
	});

	it("resolves project by name when a name is passed to 'project'", async () => {
		vi.mocked(mockClient.addTask).mockResolvedValue({
			task: NEW_TASK,
			syncToken: "tok2",
		});

		await mcpClient.callTool("todoist_tasks_add", {
			title: "In Work",
			project: "Work",
		});

		expect(mockClient.addTask).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "p1" }),
			"tok",
		);
	});

	it("passes project as-is when it does not match any project name", async () => {
		vi.mocked(mockClient.addTask).mockResolvedValue({
			task: NEW_TASK,
			syncToken: "tok2",
		});

		await mcpClient.callTool("todoist_tasks_add", {
			title: "Task",
			project: "raw-project-id",
		});

		expect(mockClient.addTask).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "raw-project-id" }),
			"tok",
		);
	});

	it("passes sectionId when section is provided", async () => {
		vi.mocked(mockClient.addTask).mockResolvedValue({
			task: NEW_TASK,
			syncToken: "tok2",
		});

		await mcpClient.callTool("todoist_tasks_add", {
			title: "Task in section",
			section: "s1",
		});

		expect(mockClient.addTask).toHaveBeenCalledWith(
			expect.objectContaining({ sectionId: "s1" }),
			"tok",
		);
	});
});

// ── sync ──────────────────────────────────────────────────────────
describe("sync", () => {
	it("fetches from todoist and returns counts", async () => {
		const result = await mcpClient.callTool("todoist_sync");

		expect(mockClient.sync).toHaveBeenCalled();
		expect(result).toMatchObject({
			projects: 0,
			sections: 0,
			labels: 0,
			tasks: 0,
		});
	});

	it("does not expose updatedTaskIds in output", async () => {
		const result = await mcpClient.callTool("todoist_sync");
		expect(result).not.toHaveProperty("updatedTaskIds");
	});
});
