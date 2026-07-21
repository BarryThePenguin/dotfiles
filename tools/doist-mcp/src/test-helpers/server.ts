import {
	LATEST_PROTOCOL_VERSION,
	McpServer,
	type JSONRPCMessage,
	type Transport,
} from "@modelcontextprotocol/server";
import { writeFileSync } from "node:fs";
import { buildServer } from "../server.ts";
import type { SyncCommand, DbTask } from "doist-core";
import { createTestContainer } from "doist-core/test-helpers";
import { setToken } from "doist-core";
import type { TestContainer } from "doist-core/test-helpers";

export const NOW = new Date().toISOString();
export const TODAY = new Date().toISOString().slice(0, 10);

export const PROJECT = {
	id: "p1",
	name: "Work",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

export const PROJECT_PERSONAL = {
	id: "p2",
	name: "Personal",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

export const SECTION = {
	id: "s1",
	project_id: "p1",
	name: "Backlog",
	section_order: 1,
	synced_at: NOW,
};

export const LABEL = { id: "l1", name: "urgent", color: "red", synced_at: NOW };

export const TASK_A = {
	id: "t1",
	project_id: "p1",
	section_id: "s1",
	parent_id: null,
	child_order: 1,
	note_count: 0,
	updated_at: NOW,
	content: "Alpha task",
	description: null,
	priority: 1,
	due_date: TODAY,
	due_string: "today",
	labels: JSON.stringify(["urgent"]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
	is_recurring: 0,
};

export const TASK_B = {
	id: "t2",
	project_id: "p1",
	section_id: null,
	parent_id: null,
	child_order: 2,
	note_count: 1,
	updated_at: NOW,
	content: "Beta task",
	description: null,
	priority: 4,
	due_date: "2030-01-01",
	due_string: "Jan 1 2030",
	labels: JSON.stringify([]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
	is_recurring: 0,
};

export class InMemoryTransport implements Transport {
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

export async function makeClient(server: McpServer) {
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
		if (result.structuredContent !== undefined) {
			return result.structuredContent;
		}
		return JSON.parse(result.content?.[0]?.text ?? "null");
	}

	return { callTool, close: () => clientTransport.close() };
}

export async function createDefaultHarness(): Promise<{
	container: TestContainer;
	client: {
		callTool: (
			name: string,
			args?: Record<string, unknown>,
		) => Promise<unknown>;
		close: () => Promise<void>;
	};
}> {
	process.env["TODOIST_API_TOKEN"] = "test-token";

	const container = createTestContainer();

	writeFileSync(
		container.paths.rcPath,
		JSON.stringify({
			projects: [
				{ id: "p1", label: "Work" },
				{ id: "p2", label: "Personal" },
			],
		}),
	);

	container.db.upsertProject(PROJECT);
	container.db.upsertProject(PROJECT_PERSONAL);
	container.db.upsertSection(SECTION);
	container.db.upsertLabel(LABEL);
	container.db.upsertTask(TASK_A);
	container.db.upsertTask(TASK_B);
	setToken(container.db, "tok");
	container.db.setLastSyncedAt(NOW);

	container.client.sync.mockImplementation(
		(_syncToken, ...commands: SyncCommand[]) => {
			let tasks: DbTask[] = [TASK_A, TASK_B];
			const tempIdMapping: Record<string, string> = {};

			for (const cmd of commands) {
				switch (cmd.type) {
					case "item_update":
						tasks = tasks.map((t) =>
							t.id !== cmd.args.id
								? t
								: {
										...t,
										content: cmd.args.content ?? t.content,
										description: cmd.args.description ?? t.description,
										priority: cmd.args.priority ?? t.priority,
										labels:
											cmd.args.labels !== undefined
												? JSON.stringify(cmd.args.labels)
												: t.labels,
										section_id: cmd.args.section_id ?? t.section_id,
									},
						);
						break;
					case "item_move":
						tasks = tasks.map((t) =>
							t.id !== cmd.args.id
								? t
								: {
										...t,
										project_id: cmd.args.project_id ?? t.project_id,
										section_id: cmd.args.section_id ?? t.section_id,
										parent_id: cmd.args.parent_id ?? t.parent_id,
									},
						);
						break;
					case "item_close":
						tasks = tasks.map((t) =>
							t.id !== cmd.args.id ? t : { ...t, is_completed: 1 },
						);
						break;
					case "item_add": {
						const newId = "new-task";
						if (cmd.temp_id) {
							tempIdMapping[cmd.temp_id] = newId;
						}
						tasks = [
							...tasks,
							{
								...TASK_A,
								id: newId,
								content: cmd.args.content,
								project_id: cmd.args.project_id ?? TASK_A.project_id,
								parent_id: cmd.args.parent_id ?? null,
								section_id: cmd.args.section_id ?? null,
								description: cmd.args.description ?? null,
								priority: cmd.args.priority ?? TASK_A.priority,
								labels: JSON.stringify(cmd.args.labels ?? []),
							},
						];
						break;
					}
				}
			}

			return Promise.resolve({
				projects: [PROJECT, PROJECT_PERSONAL],
				sections: [SECTION],
				labels: [LABEL],
				filters: [],
				tasks,
				completedTaskIds: [],
				deletedTaskIds: [],
				syncToken: "tok-sync",
				...(Object.keys(tempIdMapping).length > 0 && { tempIdMapping }),
			});
		},
	);
	container.client.fetchProjects.mockResolvedValue({
		projects: [
			{
				id: PROJECT.id,
				name: PROJECT.name,
				color: PROJECT.color,
				is_favorite: false,
				inbox_project: false,
				is_deleted: false,
				is_archived: false,
			},
			{
				id: PROJECT_PERSONAL.id,
				name: PROJECT_PERSONAL.name,
				color: PROJECT_PERSONAL.color,
				is_favorite: false,
				inbox_project: false,
				is_deleted: false,
				is_archived: false,
			},
		],
		nextCursor: null,
	});
	container.client.fetchTasksByFilter.mockImplementation(
		async (query: string) => {
			const q = query.toLowerCase();
			const allTasks = container.db.selectTasks({ completed: "incomplete" });

			function matches(t: { due: { date: string } | null; labels: string[] }) {
				const dueDate = t.due?.date ?? null;
				if (q === "overdue") {
					return dueDate && dueDate < TODAY;
				}
				if (q === "today") {
					return dueDate === TODAY;
				}
				if (q === "@thoughts") {
					return t.labels.includes("thoughts");
				}
				if (q.includes("@low-energy") || q.includes("@quick")) {
					return (
						t.labels.includes("low-energy") ||
						t.labels.includes("quick") ||
						(q.includes("@medium-energy") && t.labels.includes("medium-energy"))
					);
				}
				return true;
			}

			const filtered = allTasks.filter(matches);

			return {
				tasks: filtered.map((t) => ({
					id: t.id,
					content: t.content,
					description: t.description ?? "",
					priority: t.priority ?? 1,
					due: t.due
						? {
								date: t.due.date,
								string: t.due.string,
								is_recurring: t.due.isRecurring,
							}
						: null,
					labels: t.labels,
					checked: t.isCompleted,
					added_at: t.createdAt,
					updated_at: t.updatedAt,
					parent_id: t.parentId,
					child_order: t.childOrder,
					note_count: t.noteCount,
					project_id: t.projectId,
					section_id: t.sectionId,
					is_deleted: false,
				})),
				nextCursor: null,
			};
		},
	);

	const server = buildServer(container);
	const client = await makeClient(server);

	return { container, client };
}
