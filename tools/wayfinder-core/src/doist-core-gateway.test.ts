import { Database, type AllData, type SyncCommand } from "doist-core";
import { afterEach, describe, expect, it } from "vitest";
import { DoistCoreTodoistGateway } from "./doist-core-gateway.ts";
import type { TodoistClient } from "doist-core";
import type { DbTask } from "doist-core";

function syncItem(overrides: Partial<DbTask> = {}): DbTask {
	return {
		id: "1",
		project_id: "project-1",
		section_id: null,
		parent_id: null,
		child_order: 0,
		note_count: 0,
		updated_at: null,
		content: "Task",
		description: "",
		priority: 1,
		due_date: null,
		due_string: null,
		is_recurring: 0,
		labels: "[]",
		is_completed: 0,
		created_at: new Date().toISOString(),
		synced_at: new Date().toISOString(),
		...overrides,
	};
}

class FakeTodoistClient implements TodoistClient {
	commands: SyncCommand[] = [];
	#nextTaskId = 1;
	readonly #tasks = new Map<string, DbTask>();

	async sync(
		_syncToken?: string | null,
		...commands: SyncCommand[]
	): Promise<AllData> {
		await Promise.resolve();
		this.commands.push(...commands);
		const tempIdMapping: Record<string, string> = {};

		for (const command of commands) {
			if (command.type === "item_add") {
				const id = String(this.#nextTaskId++);
				if (command.temp_id) {
					tempIdMapping[command.temp_id] = id;
				}
				this.#tasks.set(
					id,
					syncItem({
						id,
						project_id: command.args.project_id ?? "project-1",
						parent_id: command.args.parent_id ?? null,
						content: command.args.content,
						description: command.args.description ?? "",
						labels: JSON.stringify(command.args.labels ?? []),
					}),
				);
			}
			if (command.type === "item_update") {
				const task = this.#tasks.get(command.args.id);
				if (task) {
					this.#tasks.set(command.args.id, {
						...task,
						...(command.args.description !== undefined
							? { description: command.args.description }
							: {}),
						...(command.args.labels !== undefined
							? { labels: JSON.stringify(command.args.labels) }
							: {}),
					});
				}
			}
			if (command.type === "item_close") {
				const task = this.#tasks.get(command.args.id);
				if (task) {
					this.#tasks.set(command.args.id, { ...task, is_completed: 1 });
				}
			}
		}

		return {
			projects: [],
			sections: [],
			labels: [],
			filters: [],
			tasks: Array.from(this.#tasks.values()),
			notes: [],
			completedTaskIds: commands
				.filter((command) => command.type === "item_close")
				.map((command) => command.args.id),
			deletedTaskIds: [],
			deletedNoteIds: [],
			syncToken: `token-${this.commands.length}`,
			tempIdMapping,
		};
	}

	async fetchProjects() {
		await Promise.resolve();
		return { projects: [], nextCursor: null };
	}

	async fetchTasksByFilter() {
		await Promise.resolve();
		return { tasks: [], nextCursor: null };
	}
}

let db: Database | undefined;

afterEach(() => {
	db?.close();
	db = undefined;
});

describe("DoistCoreTodoistGateway", () => {
	it("creates, updates, lists, comments on, and completes Todoist tasks through doist-core", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });

		const map = await gateway.createTask({
			content: "Wayfinder map",
			description: "Map body",
			labels: ["wayfinder_map"],
			projectId: "project-1",
		});
		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Ticket body",
			labels: ["wayfinder_grilling"],
			projectId: "project-1",
			parentId: map.id,
		});

		expect(await gateway.listSubtasks(map.id)).toMatchObject([
			{ id: ticket.id, parentId: map.id, content: "Ticket" },
		]);

		await gateway.updateTask(ticket.id, { description: "Updated body" });
		expect(await gateway.getTask(ticket.id)).toMatchObject({
			description: "Updated body",
		});

		await gateway.addComment(ticket.id, "Resolution comment");
		expect(client.commands.at(-1)).toMatchObject({
			type: "note_add",
			args: { item_id: ticket.id, content: "Resolution comment" },
		});
		expect(await gateway.getTask(ticket.id)).toMatchObject({
			comments: ["Resolution comment"],
		});

		await gateway.completeTask(ticket.id);
		expect(await gateway.getTask(ticket.id)).toMatchObject({
			isCompleted: true,
		});
	});
});
