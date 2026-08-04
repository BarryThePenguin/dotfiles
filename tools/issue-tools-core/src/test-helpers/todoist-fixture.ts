/**
 * Engine-backed Todoist test fixture.
 *
 * Builds a real doist-core Database (in-memory) plus an in-memory
 * TodoistClient that responds to sync commands with persisted, id-assigned
 * tasks — the same engine the production adapter runs on. Adapter tests use
 * this instead of hand-rolled gateway fakes, so the wire contracts they
 * assert (command batching, label merging, completion comments) are the real
 * ones.
 */

import {
	Database,
	type AllData,
	type DbTask,
	type SyncCommand,
	type TodoistClient,
} from "doist-core";
import { TodoistAdapter } from "../todoist-adapter.ts";

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

/**
 * In-memory TodoistClient that persists sync commands to task/note stores and
 * assigns real ids — the same engine the production adapter runs on.
 */
class FakeTodoistClient implements TodoistClient {
	commands: SyncCommand[] = [];
	syncCalls: SyncCommand[][] = [];
	#nextTaskId = 1;
	#nextNoteId = 1;
	readonly #tasks = new Map<string, DbTask>();
	readonly #notes = new Map<string, AllData["notes"][number]>();
	readonly #taskTimestamps: { created: string; updated: string } | undefined;
	#clockMs = Date.parse("2026-01-01T00:00:00.000Z");

	constructor(
		options: { taskTimestamps?: { created: string; updated: string } } = {},
	) {
		this.#taskTimestamps = options.taskTimestamps;
	}

	/** The fake's task store, for wire-level assertions in tests. */
	get tasks(): Map<string, DbTask> {
		return this.#tasks;
	}

	#timestamps(): { created: string; updated: string } {
		if (this.#taskTimestamps) {
			return this.#taskTimestamps;
		}
		const created = new Date(this.#clockMs).toISOString();
		this.#clockMs += 1000;
		return { created, updated: created };
	}

	async sync(
		_syncToken?: string | null,
		...commands: SyncCommand[]
	): Promise<AllData> {
		await Promise.resolve();
		this.commands.push(...commands);
		this.syncCalls.push(commands);
		const tempIdMapping: Record<string, string> = {};

		for (const command of commands) {
			if (command.type === "item_add") {
				const id = String(this.#nextTaskId++);
				if (command.temp_id) {
					tempIdMapping[command.temp_id] = id;
				}
				const { created, updated } = this.#timestamps();
				this.#tasks.set(
					id,
					syncItem({
						id,
						project_id: command.args.project_id ?? "project-1",
						parent_id: command.args.parent_id ?? null,
						content: command.args.content,
						description: command.args.description ?? "",
						labels: JSON.stringify(command.args.labels ?? []),
						created_at: created,
						updated_at: updated,
					}),
				);
			}
			if (command.type === "item_update") {
				const task = this.#tasks.get(command.args.id);
				if (task) {
					const labels =
						command.args.labels !== undefined
							? JSON.stringify(command.args.labels)
							: task.labels;
					this.#tasks.set(command.args.id, {
						...task,
						...(command.args.description !== undefined
							? { description: command.args.description }
							: {}),
						labels,
					});
				}
			}
			if (command.type === "item_close") {
				const task = this.#tasks.get(command.args.id);
				if (task) {
					this.#tasks.set(command.args.id, { ...task, is_completed: 1 });
				}
			}
			if (command.type === "note_add") {
				const id = `note-${this.#nextNoteId++}`;
				if (command.temp_id) {
					tempIdMapping[command.temp_id] = id;
				}
				this.#notes.set(id, {
					id,
					item_id: command.args.item_id,
					content: command.args.content,
					posted_at: new Date().toISOString(),
					is_deleted: false,
				});
			}
		}

		return {
			projects: [],
			sections: [],
			labels: [],
			filters: [],
			tasks: Array.from(this.#tasks.values()),
			notes: Array.from(this.#notes.values()),
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

export type TodoistTestFixture = {
	db: Database;
	client: FakeTodoistClient;
	adapter: TodoistAdapter;
	cleanup: () => void;
};

export function createTodoistFixture(
	options: {
		projectId?: string;
		taskTimestamps?: { created: string; updated: string };
	} = {},
): TodoistTestFixture {
	const db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
	const client = new FakeTodoistClient(
		options.taskTimestamps ? { taskTimestamps: options.taskTimestamps } : {},
	);
	const adapter = new TodoistAdapter(
		db,
		client,
		options.projectId ? { projectId: options.projectId } : {},
	);
	return {
		db,
		client,
		adapter,
		cleanup: () => {
			db.close();
		},
	};
}
