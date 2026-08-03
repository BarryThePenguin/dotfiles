import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMarkdownPersistenceAdapter } from "./local-markdown-adapter.ts";
import type { WayfinderPersistence } from "./modules.ts";
import {
	TodoistPersistenceAdapter,
	type TodoistCreateTaskInput,
	type TodoistGateway,
	type TodoistListTasksInput,
	type TodoistTask,
	type TodoistUpdateTaskInput,
} from "./todoist-adapter.ts";

type Fixture = {
	tracker: WayfinderPersistence;
	addOrdinaryComment: (ticketId: string, body: string) => Promise<void>;
	cleanup: () => Promise<void>;
};

class InMemoryTodoistGateway implements TodoistGateway {
	readonly tasks = new Map<string, TodoistTask>();
	#nextId = 1;

	createTask(input: TodoistCreateTaskInput): Promise<TodoistTask> {
		const id = String(this.#nextId++);
		const task: TodoistTask = {
			id,
			url: `https://app.todoist.com/app/task/${id}`,
			content: input.content,
			description: input.description,
			labels: input.labels,
			parentId: input.parentId ?? null,
			projectId: input.projectId ?? null,
			isCompleted: false,
			createdAt: null,
			updatedAt: null,
			comments: [],
		};
		this.tasks.set(id, task);
		return Promise.resolve(task);
	}

	getTask(id: string): Promise<TodoistTask> {
		const task = this.tasks.get(id);
		return task
			? Promise.resolve(task)
			: Promise.reject(new Error(`Todoist task not found: ${id}`));
	}

	async getTasks(ids: string[]): Promise<TodoistTask[]> {
		return Promise.all(ids.map((id) => this.getTask(id)));
	}

	async updateTask(
		id: string,
		input: TodoistUpdateTaskInput,
	): Promise<TodoistTask> {
		const task = await this.getTask(id);
		const updated = {
			...task,
			...(input.description === undefined
				? {}
				: { description: input.description }),
		};
		this.tasks.set(id, updated);
		return updated;
	}

	async completeTask(id: string, comment?: string): Promise<TodoistTask> {
		const task = await this.getTask(id);
		const updated = {
			...task,
			isCompleted: true,
			comments:
				comment === undefined
					? task.comments
					: [...task.comments, { content: comment, postedAt: null }],
		};
		this.tasks.set(id, updated);
		return updated;
	}

	listTasks(_input: TodoistListTasksInput = {}): Promise<TodoistTask[]> {
		return Promise.resolve([...this.tasks.values()]);
	}

	listSubtasks(parentId: string): Promise<TodoistTask[]> {
		return Promise.resolve(
			[...this.tasks.values()].filter((task) => task.parentId === parentId),
		);
	}

	async addComment(taskId: string, body: string): Promise<void> {
		const task = await this.getTask(taskId);
		this.tasks.set(taskId, {
			...task,
			comments: [...task.comments, { content: body, postedAt: null }],
		});
	}
}

async function localFixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "resolution-contract-local-"));
	const tracker = new LocalMarkdownPersistenceAdapter(root);
	return {
		tracker,
		addOrdinaryComment: async (ticketId, body) => {
			const ticket = await tracker.getTicket(ticketId);
			const path = join(root, ticket.mapId, ticket.url);
			const markdown = await readFile(path, "utf8");
			await writeFile(path, `${markdown}\n## Comments\n\n> ${body}\n`);
		},
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

function todoistFixture(): Fixture {
	const gateway = new InMemoryTodoistGateway();
	const tracker = new TodoistPersistenceAdapter(gateway, {
		projectId: "project-1",
	});
	return {
		tracker,
		addOrdinaryComment: (ticketId, body) => gateway.addComment(ticketId, body),
		cleanup: async () => {},
	};
}

const fixtures = [
	["Local Markdown", localFixture],
	["Todoist", todoistFixture],
] as const;

describe.each(fixtures)("%s resolution contract", (_name, createFixture) => {
	let fixture: Fixture;
	let mapId: string;
	let ticketId: string;

	beforeEach(async () => {
		fixture = await createFixture();
		const map = await fixture.tracker.createMap({
			title: "Resolution contract",
			destination: "The first Resolution is durable.",
		});
		mapId = map.id;
		const ticket = await fixture.tracker.createChildTicket({
			mapId,
			title: "Choose a resolution",
			type: "grilling",
			question: "Which answer wins?",
		});
		ticketId = ticket.id;
	});

	afterEach(async () => {
		await fixture.cleanup();
	});

	it("records the first Resolution and closes the ticket together", async () => {
		const resolved = await fixture.tracker.recordResolution(
			ticketId,
			"Use the tracker-native seam.",
		);

		expect(resolved.status).toBe("closed");
		expect(resolved.comments).toContain("Use the tracker-native seam.");
	});

	it("makes a repeated matching Resolution a no-op", async () => {
		await fixture.tracker.recordResolution(ticketId, "Keep the first answer.");

		const repeated = await fixture.tracker.recordResolution(
			ticketId,
			"Keep the first answer.",
		);

		expect(repeated.status).toBe("closed");
		expect(repeated.comments).toEqual(["Keep the first answer."]);
	});

	it("does not replace a different first Resolution", async () => {
		await fixture.tracker.recordResolution(ticketId, "The first answer.");

		await expect(
			fixture.tracker.recordResolution(ticketId, "A replacement answer."),
		).rejects.toThrow(/Resolution/i);

		const ticket = await fixture.tracker.getTicket(ticketId);
		expect(ticket.comments).toContain("The first answer.");
	});

	it("rejects a closed ticket that has no matching Resolution", async () => {
		await fixture.tracker.closeTicket(ticketId);

		await expect(
			fixture.tracker.recordResolution(ticketId, "Too late."),
		).rejects.toThrow(/Resolution/i);
	});

	it("preserves an ordinary comment while recording the Resolution", async () => {
		await fixture.addOrdinaryComment(ticketId, "An existing note.");
		await fixture.tracker.recordResolution(ticketId, "The durable answer.");

		const ticket = await fixture.tracker.getTicket(ticketId);
		expect(ticket.comments).toContain("An existing note.");
		expect(ticket.comments).toContain("The durable answer.");
	});
});
