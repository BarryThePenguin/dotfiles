import { Database, type AllData, type SyncCommand } from "doist-core";
import { afterEach, describe, expect, it } from "vitest";
import { DoistCoreTodoistGateway } from "./doist-core-gateway.ts";
import { TodoistTracker } from "./todoist-tracker.ts";
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
	syncCalls: SyncCommand[][] = [];
	#nextTaskId = 1;
	#nextNoteId = 1;
	readonly #tasks = new Map<string, DbTask>();
	readonly #notes = new Map<string, AllData["notes"][number]>();
	readonly #taskTimestamps: { created: string; updated: string };

	constructor(
		options: { taskTimestamps?: { created: string; updated: string } } = {},
	) {
		this.#taskTimestamps = options.taskTimestamps ?? {
			created: new Date().toISOString(),
			updated: new Date().toISOString(),
		};
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
				this.#tasks.set(
					id,
					syncItem({
						id,
						project_id: command.args.project_id ?? "project-1",
						parent_id: command.args.parent_id ?? null,
						content: command.args.content,
						description: command.args.description ?? "",
						labels: JSON.stringify(command.args.labels ?? []),
						created_at: this.#taskTimestamps.created,
						updated_at: this.#taskTimestamps.updated,
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
			comments: [{ content: "Resolution comment" }],
		});

		await gateway.completeTask(ticket.id);
		expect(await gateway.getTask(ticket.id)).toMatchObject({
			isCompleted: true,
		});
	});

	// ── Label contract (set-based merge, one round trip, delta args) ──

	it("updateTask with addLabels/removeLabels makes one round trip with the set-merged result on the wire", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });

		// Create a task carrying initial labels
		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Body",
			labels: ["urgent", "home"],
			projectId: "project-1",
		});

		// Reset the captured sync call counter so we can assert
		// the upcoming updateTask makes exactly one round trip.
		client.syncCalls.length = 0;

		await gateway.updateTask(ticket.id, {
			addLabels: ["work"],
			removeLabels: ["home"],
		});

		// Exactly one sync call carried the update. The Todoist API only
		// accepts an absolute label set, so the merged result is on the
		// wire — the delta contract lives in the user-facing surface.
		expect(client.syncCalls).toHaveLength(1);
		const updateCall = client.syncCalls[0];
		expect(updateCall).toHaveLength(1);
		expect(updateCall?.[0]).toMatchObject({
			type: "item_update",
			args: {
				id: ticket.id,
				labels: ["urgent", "work"],
			},
		});

		// Result reflects the set-merged state.
		expect(await gateway.getTask(ticket.id)).toMatchObject({
			labels: ["urgent", "work"],
		});
	});

	it("updateTask with only addLabels is a single round trip", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });

		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Body",
			labels: ["urgent"],
			projectId: "project-1",
		});
		client.syncCalls.length = 0;

		await gateway.updateTask(ticket.id, { addLabels: ["new"] });

		expect(client.syncCalls).toHaveLength(1);
		expect(client.syncCalls[0]?.[0]?.args).toMatchObject({
			id: ticket.id,
			labels: ["urgent", "new"],
		});
	});

	it("updateTask is idempotent when addLabels overlaps with existing labels", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });

		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Body",
			labels: ["urgent", "home"],
			projectId: "project-1",
		});

		await gateway.updateTask(ticket.id, { addLabels: ["home", "work"] });

		expect((await gateway.getTask(ticket.id)).labels).toEqual([
			"urgent",
			"home",
			"work",
		]);
	});

	// ── Close with optional comment (one atomic sync) ────────────────

	it("completeTask with a comment closes and comments in one atomic sync", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });

		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Body",
			labels: ["wayfinder_grilling"],
			projectId: "project-1",
		});
		client.syncCalls.length = 0;

		await gateway.completeTask(ticket.id, "Closing: wontfix");

		// One sync carried both the close and the note add
		expect(client.syncCalls).toHaveLength(1);
		const types = (client.syncCalls[0] ?? []).map((c) => c.type).toSorted();
		expect(types).toEqual(["item_close", "note_add"]);

		// Task is closed and the comment is persisted in the same transaction
		const result = await gateway.getTask(ticket.id);
		expect(result).toMatchObject({
			isCompleted: true,
			comments: [{ content: "Closing: wontfix" }],
		});
	});

	it("completeTask without a comment is still a single sync with one close command", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });

		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Body",
			labels: ["wayfinder_grilling"],
			projectId: "project-1",
		});
		client.syncCalls.length = 0;

		await gateway.completeTask(ticket.id);

		expect(client.syncCalls).toHaveLength(1);
		expect(client.syncCalls[0]).toHaveLength(1);
		expect(client.syncCalls[0]?.[0]).toMatchObject({
			type: "item_close",
			args: { id: ticket.id },
		});
	});

	// ── Timestamps on read ──────────────────────────────────────────

	it("surfaces task createdAt and updatedAt on read", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const created = "2026-01-01T12:00:00.000000Z";
		const updated = "2026-02-01T12:00:00.000000Z";
		const client = new FakeTodoistClient({
			taskTimestamps: { created, updated },
		});
		const gateway = new DoistCoreTodoistGateway({ db, client });

		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Body",
			labels: ["wayfinder_grilling"],
			projectId: "project-1",
		});

		const result = await gateway.getTask(ticket.id);
		expect(result.createdAt).toBe(created);
		expect(result.updatedAt).toBe(updated);
	});

	it("surfaces comment postedAt on read", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });

		const ticket = await gateway.createTask({
			content: "Ticket",
			description: "Body",
			labels: ["wayfinder_grilling"],
			projectId: "project-1",
		});

		await gateway.addComment(ticket.id, "Resolution: use Todoist");

		const result = await gateway.getTask(ticket.id);
		expect(result.comments).toHaveLength(1);
		expect(result.comments[0]?.content).toBe("Resolution: use Todoist");
		expect(result.comments[0]?.postedAt).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
		);
	});

	// -- Generic issue round-trip through the real gateway ----------------

	it("creates and reads a generic Issue through the TodoistTracker over the real gateway", async () => {
		db = new Database({ dbPath: ":memory:", rcPath: "/tmp/.doistrc" });
		const client = new FakeTodoistClient();
		const gateway = new DoistCoreTodoistGateway({ db, client });
		const tracker = new TodoistTracker(gateway, { projectId: "project-1" });

		const created = await tracker.createIssue({
			title: "Add a generic issue surface",
			body: "Spec is at /path/to/spec.md.",
			labels: ["needs-triage", "bug"],
		});

		expect(created).toMatchObject({
			title: "Add a generic issue surface",
			status: "open",
			labels: ["needs-triage", "bug"],
			comments: [],
		});
		expect(created.createdAt).toBeDefined();
		expect(created.updatedAt).toBeDefined();

		const read = await tracker.readIssue(created.id);
		expect(read).toMatchObject({
			id: created.id,
			url: created.url,
			title: created.title,
			body: created.body,
			labels: ["needs-triage", "bug"],
			status: "open",
		});
	});
});
