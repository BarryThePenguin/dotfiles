import {
	LATEST_PROTOCOL_VERSION,
	type JSONRPCMessage,
	type Transport,
} from "@modelcontextprotocol/server";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	openDb,
	upsertLabel,
	upsertProject,
	upsertSection,
	upsertTask,
} from "./db.ts";
import { buildServer, type Context } from "./server.ts";
import type { TodoistClient } from "./todoist.ts";

vi.mock("./env.ts", () => ({
	env: new Proxy({}, { get: (_, k) => process.env[k as string] }),
}));

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
async function makeClient({ server }: Context) {
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
		};
		if (result.isError) {
			throw new Error(result.content?.[0]?.text ?? "tool error");
		}
		return JSON.parse(result.content?.[0]?.text ?? "null");
	}

	return { callTool, close: () => clientTransport.close() };
}

// ── Shared setup ──────────────────────────────────────────────────
let tempDir: string;
let dbFile: string;
let mockClient: TodoistClient;
let mcpClient: Awaited<ReturnType<typeof makeClient>>;
let destroyDb: () => void;

beforeEach(async () => {
	tempDir = mkdtempSync(join(tmpdir(), "doist-mcp-test-"));
	dbFile = join(tempDir, "test.db");
	const rcFile = join(tempDir, ".doistrc");

	writeFileSync(
		rcFile,
		JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
	);
	process.env["TODOIST_DB_PATH"] = dbFile;
	process.env["TODOIST_RC_PATH"] = rcFile;
	process.env["TODOIST_API_TOKEN"] = "test-token";

	const db = openDb(dbFile);
	upsertProject(db, PROJECT);
	upsertSection(db, SECTION);
	upsertLabel(db, LABEL);
	upsertTask(db, TASK_A);
	upsertTask(db, TASK_B);

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

	const built = buildServer(mockClient);
	destroyDb = () => {
		built.db.close();
	};
	mcpClient = await makeClient(built);
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
type TasksListResult = { syncedAt: string | null; tasks: { id: string; labels: unknown }[] };
async function tasksList(args: Record<string, unknown> = {}) {
	return (await mcpClient.callTool("tasks_list", args)) as TasksListResult;
}

describe("tasks_list", () => {
	it("returns all incomplete tasks", async () => {
		const { tasks } = await tasksList();
		expect(tasks).toHaveLength(2);
		expect(tasks.map((t) => t.id)).toEqual(expect.arrayContaining(["t1", "t2"]));
	});

	it("returns labels as an array, not a JSON string", async () => {
		const { tasks } = await tasksList();
		const t1 = tasks.find((t) => t.id === "t1");
		expect(Array.isArray(t1?.labels)).toBe(true);
		expect(t1?.labels).toEqual(["urgent"]);
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
		const tasks = (await mcpClient.callTool("tasks_search", {
			query: "Alpha",
		})) as { id: string; labels: unknown }[];
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.id).toBe("t1");
		expect(Array.isArray(tasks[0]?.labels)).toBe(true);
	});

	it("returns empty for no match", async () => {
		const tasks = (await mcpClient.callTool("tasks_search", {
			query: "zzznomatch",
		})) as unknown[];
		expect(tasks).toHaveLength(0);
	});
});

// ── tasks_get ─────────────────────────────────────────────────────
describe("tasks_get", () => {
	it("returns task by id", async () => {
		const task = (await mcpClient.callTool("tasks_get", { id: "t1" })) as {
			content: string;
		};
		expect(task.content).toBe("Alpha task");
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
		const projects = (await mcpClient.callTool("projects_list")) as {
			id: string;
			name: string;
		}[];
		expect(projects).toHaveLength(1);
		expect(projects[0]?.name).toBe("Work");
	});
});

// ── labels_list ───────────────────────────────────────────────────
describe("labels_list", () => {
	it("returns all labels", async () => {
		const labels = (await mcpClient.callTool("labels_list")) as {
			name: string;
		}[];
		expect(labels).toHaveLength(1);
		expect(labels[0]?.name).toBe("urgent");
	});
});

// ── sections_list ─────────────────────────────────────────────────
describe("sections_list", () => {
	it("returns all sections", async () => {
		const sections = (await mcpClient.callTool("sections_list")) as {
			name: string;
		}[];
		expect(sections).toHaveLength(1);
		expect(sections[0]?.name).toBe("Backlog");
	});

	it("filters by project", async () => {
		const sections = (await mcpClient.callTool("sections_list", {
			project: "p1",
		})) as unknown[];
		expect(sections).toHaveLength(1);
	});

	it("returns empty for unknown project", async () => {
		const sections = (await mcpClient.callTool("sections_list", {
			project: "p999",
		})) as unknown[];
		expect(sections).toHaveLength(0);
	});

	it("filters by project name as well as id", async () => {
		const sections = (await mcpClient.callTool("sections_list", {
			project: "Work",
		})) as unknown[];
		expect(sections).toHaveLength(1);
	});
});

// ── tasks_complete ────────────────────────────────────────────────
describe("tasks_complete", () => {
	it("calls completeTask and marks the row done in the db", async () => {
		const result = await mcpClient.callTool("tasks_complete", {
			id: "t1",
		});
		expect(result).toEqual({ ok: true });
		expect(mockClient.completeTask).toHaveBeenCalledWith("t1", "tok");

		const tempDb = openDb(dbFile);
		const row = tempDb.get(
			tempDb.q
				.selectFrom("tasks")
				.select("is_completed")
				.where("id", "=", "t1")
				.compile(),
		);
		expect(row?.is_completed).toBe(1);
	});
});

// ── tasks_update ──────────────────────────────────────────────────
describe("tasks_update", () => {
	it("updates task title", async () => {
		vi.mocked(mockClient.updateTask).mockResolvedValue({
			task: { ...TASK_A, content: "Updated title" },
			syncToken: "tok2",
		});

		const result = (await mcpClient.callTool("tasks_update", {
			id: "t1",
			title: "Updated title",
		})) as { content: string };

		expect(mockClient.updateTask).toHaveBeenCalledWith(
			"t1",
			{
				title: "Updated title",
			},
			"tok",
		);
		expect(result.content).toBe("Updated title");
	});

	it("appends a new label to existing labels", async () => {
		await mcpClient.callTool("tasks_update", {
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
		await mcpClient.callTool("tasks_update", {
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
		await mcpClient.callTool("tasks_update", {
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

		const result = (await mcpClient.callTool("tasks_add", {
			title: "New task",
		})) as { id: string; content: string };

		expect(mockClient.addTask).toHaveBeenCalledWith(
			{ title: "New task" },
			null,
		);
		expect(result.id).toBe("t-new");
		expect(result.content).toBe("New task");
	});

	it("resolves project by name when a name is passed to 'project'", async () => {
		vi.mocked(mockClient.addTask).mockResolvedValue({
			task: NEW_TASK,
			syncToken: "tok2",
		});

		await mcpClient.callTool("tasks_add", {
			title: "In Work",
			project: "Work",
		});

		expect(mockClient.addTask).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "p1" }),
			null,
		);
	});

	it("passes project as-is when it does not match any project name", async () => {
		vi.mocked(mockClient.addTask).mockResolvedValue({
			task: NEW_TASK,
			syncToken: "tok2",
		});

		await mcpClient.callTool("tasks_add", {
			title: "Task",
			project: "raw-project-id",
		});

		expect(mockClient.addTask).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: "raw-project-id" }),
			null,
		);
	});

	it("passes sectionId when section is provided", async () => {
		vi.mocked(mockClient.addTask).mockResolvedValue({
			task: NEW_TASK,
			syncToken: "tok2",
		});

		await mcpClient.callTool("tasks_add", {
			title: "Task in section",
			section: "s1",
		});

		expect(mockClient.addTask).toHaveBeenCalledWith(
			expect.objectContaining({ sectionId: "s1" }),
			null,
		);
	});
});

// ── sync ──────────────────────────────────────────────────────────
describe("sync", () => {
	it("fetches from todoist and returns counts", async () => {
		const result = (await mcpClient.callTool("sync")) as {
			projects: number;
			sections: number;
			labels: number;
			tasks: number;
			reconciled: number;
		};

		expect(mockClient.sync).toHaveBeenCalled();
		expect(result).toMatchObject({
			projects: 0,
			sections: 0,
			labels: 0,
			tasks: 0,
		});
	});

	it("does not expose updatedTaskIds in output", async () => {
		const result = (await mcpClient.callTool("sync")) as Record<
			string,
			unknown
		>;
		expect(result).not.toHaveProperty("updatedTaskIds");
	});
});

// ── conflict detection ────────────────────────────────────────────
describe("conflict detection", () => {
	beforeEach(async () => {
		// Establish a sync token via the server so incremental syncs work
		await mcpClient.callTool("sync");
	});

	it("tasks_update returns conflict when task was modified upstream", async () => {
		vi.mocked(mockClient.sync).mockResolvedValueOnce({
			projects: [PROJECT],
			sections: [],
			labels: [],
			tasks: [TASK_A],
			deletedTaskIds: [],
			syncToken: "tok2",
		});

		const result = (await mcpClient.callTool("tasks_update", {
			id: "t1",
			title: "New title",
		})) as { conflict: boolean; upstream: { id: string }; hint: string };

		expect(result.conflict).toBe(true);
		expect(result.upstream.id).toBe("t1");
		expect(result.hint).toBeTypeOf("string");
		expect(mockClient.updateTask).not.toHaveBeenCalled();
	});

	it("tasks_complete returns conflict when task was modified upstream", async () => {
		vi.mocked(mockClient.sync).mockResolvedValueOnce({
			projects: [PROJECT],
			sections: [],
			labels: [],
			tasks: [TASK_A],
			deletedTaskIds: [],
			syncToken: "tok2",
		});

		const result = (await mcpClient.callTool("tasks_complete", {
			id: "t1",
		})) as { conflict: boolean; upstream: { id: string }; hint: string };

		expect(result.conflict).toBe(true);
		expect(result.hint).toBeTypeOf("string");
		expect(result.upstream.id).toBe("t1");
		expect(mockClient.completeTask).not.toHaveBeenCalled();
	});

	it("tasks_update proceeds when task was not modified upstream", async () => {
		await mcpClient.callTool("tasks_update", { id: "t1", title: "New title" });
		expect(mockClient.updateTask).toHaveBeenCalled();
	});
});
