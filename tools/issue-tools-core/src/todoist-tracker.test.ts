import { describe, expect, it } from "vitest";
import { TODOIST_TICKET_TYPE_LABELS, WAYFINDER_MAP_LABEL } from "./labels.ts";
import {
	TodoistTracker,
	type TodoistCreateTaskInput,
	type TodoistGateway,
	type TodoistListTasksInput,
	type TodoistTask,
	type TodoistUpdateTaskInput,
} from "./todoist-tracker.ts";

class InMemoryTodoistGateway implements TodoistGateway {
	readonly tasks = new Map<string, TodoistTask>();
	#nextTaskNumber = 1;
	readonly #createdAt = new Date().toISOString();

	createTask(input: TodoistCreateTaskInput): Promise<TodoistTask> {
		const id = String(this.#nextTaskNumber++);
		const task: TodoistTask = {
			id,
			url: `https://app.todoist.com/app/task/${id}`,
			content: input.content,
			description: input.description,
			labels: input.labels,
			parentId: input.parentId ?? null,
			projectId: input.projectId ?? null,
			isCompleted: false,
			createdAt: this.#createdAt,
			updatedAt: this.#createdAt,
			comments: [],
		};
		this.tasks.set(id, task);
		return Promise.resolve(task);
	}

	getTask(id: string): Promise<TodoistTask> {
		const task = this.tasks.get(id);
		if (!task) {
			return Promise.reject(new Error(`Todoist task not found: ${id}`));
		}
		return Promise.resolve(task);
	}

	async getTasks(ids: string[]): Promise<TodoistTask[]> {
		const found: TodoistTask[] = [];
		for (const id of ids) {
			const task = this.tasks.get(id);
			if (!task) {
				throw new Error(`Todoist task not found: ${id}`);
			}
			found.push(task);
		}
		return Promise.resolve(found);
	}

	async updateTask(
		id: string,
		input: TodoistUpdateTaskInput,
	): Promise<TodoistTask> {
		const task = await this.getTask(id);
		let labels = task.labels;
		if (input.addLabels !== undefined || input.removeLabels !== undefined) {
			const remove = new Set(input.removeLabels ?? []);
			const additions = new Set(
				(input.addLabels ?? []).filter((label) => !remove.has(label)),
			);
			labels = [
				...new Set(
					task.labels.filter((label) => !remove.has(label)),
				).union(additions),
			];
		}
		const updated: TodoistTask = {
			...task,
			...(input.description !== undefined
				? { description: input.description }
				: {}),
			...(input.addLabels !== undefined || input.removeLabels !== undefined
				? { labels }
				: {}),
		};
		this.tasks.set(id, updated);
		return updated;
	}

	async completeTask(id: string, comment?: string): Promise<TodoistTask> {
		const task = await this.getTask(id);
		if (comment !== undefined) {
			task.comments.push({ content: comment, postedAt: new Date().toISOString() });
		}
		const updated = { ...task, isCompleted: true };
		this.tasks.set(id, updated);
		return updated;
	}

	listTasks(input: TodoistListTasksInput = {}): Promise<TodoistTask[]> {
		let tasks = Array.from(this.tasks.values());
		if (input.labels) {
			tasks = tasks.filter((task) =>
				input.labels?.every((label) => task.labels.includes(label)),
			);
		}
		return Promise.resolve(tasks);
	}

	listSubtasks(parentId: string): Promise<TodoistTask[]> {
		return Promise.resolve(
			Array.from(this.tasks.values()).filter(
				(task) => task.parentId === parentId,
			),
		);
	}

	async addComment(taskId: string, body: string): Promise<void> {
		const task = await this.getTask(taskId);
		task.comments.push({ content: body, postedAt: new Date().toISOString() });
	}
}

describe("TodoistTracker", () => {
	it("creates a map task and ticket subtasks using Todoist labels", async () => {
		const gateway = new InMemoryTodoistGateway();
		const tracker = new TodoistTracker(gateway, { projectId: "project-1" });

		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
			notes: "Use subtasks as tickets.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose dependency representation",
			type: "grilling",
			question: "How should blockers be represented?",
		});

		expect(gateway.tasks.get(map.id)).toMatchObject({
			content: "Plan Todoist Wayfinder",
			projectId: "project-1",
			labels: [WAYFINDER_MAP_LABEL],
		});
		const ticketTask = gateway.tasks.get(ticket.id);
		expect(ticketTask).toMatchObject({
			content: "Choose dependency representation",
			parentId: map.id,
			labels: [TODOIST_TICKET_TYPE_LABELS.grilling],
		});
		expect(ticketTask?.description).not.toContain("wayfinder:map");
		expect(ticket).toMatchObject({
			mapId: map.id,
			type: "grilling",
			status: "open",
		});
	});

	it("uses the Todoist parent relationship as the ticket's map id", async () => {
		const gateway = new InMemoryTodoistGateway();
		const tracker = new TodoistTracker(gateway, { projectId: "project-1" });
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose relationship source",
			type: "grilling",
			question: "Where should map identity come from?",
		});

		const task = gateway.tasks.get(ticket.id);
		expect(task?.parentId).toBe(map.id);
		expect(task?.description).not.toContain("wayfinder:map");
		expect(await tracker.getTicket(ticket.id)).toMatchObject({ mapId: map.id });
	});

	it("lists frontier tickets using completion, claim metadata, and blocker metadata", async () => {
		const gateway = new InMemoryTodoistGateway();
		const tracker = new TodoistTracker(gateway, {
			projectId: "project-1",
		});
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const blocker = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocking research",
			type: "research",
			question: "What blocks the next decision?",
		});
		const blocked = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocked decision",
			type: "grilling",
			question: "What follows research?",
			blockerIds: [blocker.id],
		});
		expect(gateway.tasks.get(blocked.id)?.description).toContain(
			`## Blocked by:\n\n- [Blocking research](${blocker.url})`,
		);
		expect(gateway.tasks.get(blocked.id)?.description).not.toContain(
			"wayfinder:blocked-by",
		);
		const claimed = await tracker.createChildTicket({
			mapId: map.id,
			title: "Claimed decision",
			type: "task",
			question: "Who owns this?",
		});
		await tracker.claimTicketIfUnclaimed(claimed.id, "agent-1");

		expect(
			(await tracker.listFrontierTickets(map.id)).map((t) => t.id),
		).toEqual([blocker.id]);

		await tracker.closeTicket(blocker.id);

		expect(
			(await tracker.listFrontierTickets(map.id)).map((t) => t.id),
		).toEqual([blocked.id]);
	});

	it("claims, comments on, records, and closes Todoist tickets", async () => {
		const gateway = new InMemoryTodoistGateway();
		const tracker = new TodoistTracker(gateway, { projectId: "project-1" });
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose tracker",
			type: "grilling",
			question: "Which tracker owns durable state?",
		});

		expect(
			await tracker.claimTicketIfUnclaimed(ticket.id, "agent-1"),
		).toMatchObject({ claimed: true, ticket: { claimedBy: "agent-1" } });
		const claimedDescription = gateway.tasks.get(ticket.id)?.description ?? "";
		expect(claimedDescription).toContain("Claimed by: agent-1");
		expect(claimedDescription).not.toContain("wayfinder:claimed-by");
		expect(
			await tracker.claimTicketIfUnclaimed(ticket.id, "agent-2"),
		).toMatchObject({ claimed: false, ticket: { claimedBy: "agent-1" } });

		await tracker.postComment(ticket.id, "Resolution: use Todoist.");
		await tracker.recordDecision(map.id, {
			title: ticket.title,
			url: ticket.url,
			gist: "Todoist owns durable state.",
		});
		await tracker.closeTicket(ticket.id);

		expect(await tracker.getTicket(ticket.id)).toMatchObject({
			status: "closed",
			comments: ["Resolution: use Todoist."],
		});

		await tracker.unclaimTicket(ticket.id);
		const unclaimedDescription = gateway.tasks.get(ticket.id)?.description ?? "";
		expect(unclaimedDescription).not.toContain("Claimed by:");
		expect(unclaimedDescription).not.toContain("wayfinder:claimed-by");
		expect((await tracker.getMap(map.id)).decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		]);
	});

	// -- Generic issue surface -------------------------------------------

	it("creates and reads a generic issue via the Todoist gateway", async () => {
		const gateway = new InMemoryTodoistGateway();
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
			url: `https://app.todoist.com/app/task/${created.id}`,
		});
		expect(gateway.tasks.get(created.id)).toMatchObject({
			content: "Add a generic issue surface",
			description: "Spec is at /path/to/spec.md.",
			labels: ["needs-triage", "bug"],
			projectId: "project-1",
		});

		const read = await tracker.readIssue(created.id);
		expect(read).toMatchObject({
			id: created.id,
			url: created.url,
			title: created.title,
			body: "Spec is at /path/to/spec.md.",
			labels: ["needs-triage", "bug"],
			status: "open",
			comments: [],
		});
		expect(read.createdAt).toBeDefined();
		expect(read.updatedAt).toBeDefined();
	});

	it("reads a generic issue by its URL", async () => {
		const gateway = new InMemoryTodoistGateway();
		const tracker = new TodoistTracker(gateway, { projectId: "project-1" });

		const created = await tracker.createIssue({
			title: "Untracked question",
			body: "Body.",
		});

		const read = await tracker.readIssue(created.url);
		expect(read.id).toBe(created.id);
	});
});
