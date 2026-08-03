import { describe, expect, it, vi } from "vitest";
import { TODOIST_TICKET_TYPE_LABELS, WAYFINDER_MAP_LABEL } from "./labels.ts";
import { createTrackerModules } from "./modules.ts";
import {
	TodoistPersistenceAdapter,
	type TodoistCreateTaskInput,
	type TodoistGateway,
	type TodoistListTasksInput,
	type TodoistTask,
	type TodoistUpdateTaskInput,
} from "./todoist-adapter.ts";

class InMemoryTodoistGateway implements TodoistGateway {
	readonly tasks = new Map<string, TodoistTask>();
	#nextTaskNumber = 1;
	#clockMs = Date.parse("2026-01-01T00:00:00.000Z");
	#currentTimestamp(): string {
		return new Date(this.#clockMs).toISOString();
	}
	tickClock(ms: number = 1000): void {
		this.#clockMs += ms;
	}

	createTask(input: TodoistCreateTaskInput): Promise<TodoistTask> {
		const id = String(this.#nextTaskNumber++);
		const now = this.#currentTimestamp();
		const task: TodoistTask = {
			id,
			url: `https://app.todoist.com/app/task/${id}`,
			content: input.content,
			description: input.description,
			labels: input.labels,
			parentId: input.parentId ?? null,
			projectId: input.projectId ?? null,
			isCompleted: false,
			createdAt: now,
			updatedAt: now,
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
		task.comments.push({
			content: body,
			postedAt: this.#currentTimestamp(),
		});
	}
}

describe("TodoistPersistenceAdapter", () => {
	it("creates a map task and ticket subtasks using Todoist labels", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);
		const tracker = modules.wayfinder;

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
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);
		const tracker = modules.wayfinder;
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
		expect((await tracker.getTicketDetail(ticket.id)).ticket).toMatchObject({
			mapId: map.id,
		});
	});

	it("lists frontier tickets using completion, claim metadata, and blocker metadata", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, {
			projectId: "project-1",
		});
		const modules = createTrackerModules(adapter);
		const tracker = modules.wayfinder;
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
			(await tracker.getMapDetail(map.id)).frontier.map((t) => t.id),
		).toEqual([blocker.id]);

		await adapter.closeTicket(blocker.id);

		expect(
			(await tracker.getMapDetail(map.id)).frontier.map((t) => t.id),
		).toEqual([blocked.id]);
	});

	it("claims, resolves, records, and reads Todoist tickets", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);
		const tracker = modules.wayfinder;
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

		const result = await tracker.resolveTicket({
			ticketId: ticket.id,
			mapId: map.id,
			resolution: "Resolution: use Todoist.",
			gist: "Todoist owns durable state.",
		});
		expect(result.outcome).toBe("complete");

		expect((await tracker.getTicketDetail(ticket.id)).ticket).toMatchObject({
			status: "closed",
			comments: ["Resolution: use Todoist."],
		});

		await tracker.unclaimTicket(ticket.id);
		const unclaimedDescription = gateway.tasks.get(ticket.id)?.description ?? "";
		expect(unclaimedDescription).not.toContain("Claimed by:");
		expect(unclaimedDescription).not.toContain("wayfinder:claimed-by");
		expect((await tracker.getMapDetail(map.id)).map.decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		]);
	});

	it("keeps historical Todoist comments native on fresh ticket reads", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);
		const tracker = modules.wayfinder;
		const map = await tracker.createMap({
			title: "Historical comments",
			destination: "Existing comments retain their tracker meaning.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Read old comments",
			type: "research",
			question: "Are old comments still ordinary comments?",
		});

		await gateway.addComment(ticket.id, "Historical note");

		expect((await tracker.getTicketDetail(ticket.id)).ticket).toMatchObject({
			comments: ["Historical note"],
		});
	});

	// -- Generic issue surface -------------------------------------------

	it("creates and reads a generic issue via the Todoist gateway", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
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

		const read = await modules.issues.readIssue(created.id);
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
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Untracked question",
			body: "Body.",
		});

		const read = await modules.issues.readIssue(created.url);
		expect(read.id).toBe(created.id);
	});

	// -- Label delta contract (issue_label) -------------------------------

	it("updateIssueLabels applies delta addLabels/removeLabels in one round trip", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const updateSpy = vi.spyOn(gateway, "updateTask");
		const after = await modules.issues.updateIssueLabels(created.id, {
			add: ["bug"],
		});

		expect(after.labels).toEqual(["needs-triage", "bug"]);
		expect(updateSpy).toHaveBeenCalledTimes(1);
		expect(updateSpy).toHaveBeenCalledWith(created.id, {
			addLabels: ["bug"],
		});
	});

	it("updateIssueLabels removes the right labels and never sends an absolute set", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Multi-label",
			body: "Body.",
			labels: ["needs-triage", "bug", "home"],
		});

		const updateSpy = vi.spyOn(gateway, "updateTask");
		const after = await modules.issues.updateIssueLabels(created.id, {
			remove: ["needs-triage", "home"],
		});

		expect(after.labels).toEqual(["bug"]);
		expect(updateSpy).toHaveBeenCalledTimes(1);
		const call = updateSpy.mock.calls[0]?.[1];
		expect(call?.addLabels).toBeUndefined();
		expect(call?.removeLabels).toEqual(["needs-triage", "home"]);
	});

	it("updateIssueLabels preserves wayfinder: labels across a triage state transition", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Map parent",
			body: "Body.",
			labels: ["wayfinder_map", "needs-triage"],
		});

		const after = await modules.issues.updateIssueLabels(created.id, {
			add: ["ready-for-agent"],
			remove: ["needs-triage"],
		});

		expect(after.labels).toEqual(["wayfinder_map", "ready-for-agent"]);
	});

	it("updateIssueLabels makes remove win when the same label is in both add and remove", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Tricky",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const after = await modules.issues.updateIssueLabels(created.id, {
			add: ["needs-triage"],
			remove: ["needs-triage"],
		});

		expect(after.labels).toEqual([]);
	});

	// -- issue_comment / issue_close (Todoist) ---------------------------

	it("comments on a generic issue and reads it back with postedAt", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		const { comment } = await modules.issues.commentOnIssue(
			created.id,
			"First agent note",
		);
		expect(comment.content).toBe("First agent note");
		expect(comment.postedAt).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
		);

		const read = await modules.issues.readIssue(created.id);
		expect(read.comments).toHaveLength(1);
		expect(read.comments[0]?.content).toBe("First agent note");
		expect(read.comments[0]?.postedAt).toBeDefined();
	});

	it("closes a generic issue through the gateway's completeTask", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const completeSpy = vi.spyOn(gateway, "completeTask");
		const { status } = await modules.issues.closeIssue(created.id);
		expect(status).toBe("closed");
		expect(completeSpy).toHaveBeenCalledWith(created.id, undefined);

		const read = await modules.issues.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.labels).toEqual(["needs-triage"]);
	});

	it("closes with a comment, lands the closing note in one atomic sync", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["wontfix"],
		});

		const { status } = await modules.issues.closeIssue(created.id, {
			comment: "Closing: wontfix",
		});
		expect(status).toBe("closed");

		const read = await modules.issues.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.comments.map((c) => c.content)).toEqual(["Closing: wontfix"]);
	});

	// -- issue_list (Todoist) ---------------------------------------------

	it("lists open issues by default, oldest first, with status on every row", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const first = await modules.issues.createIssue({
			title: "First issue",
			body: "Body.",
		});
		// Force distinct createdAt on the in-memory tasks.
		gateway.tickClock();
		const second = await modules.issues.createIssue({
			title: "Second issue",
			body: "Body.",
		});
		await modules.issues.closeIssue(second.id);

		const issues = await modules.issues.listIssues({});
		expect(issues.map((issue) => issue.id)).toEqual([first.id]);
		expect(issues.every((issue) => issue.status === "open")).toBe(true);
	});

	it("lists closed issues when state is 'closed' and all when state is 'any'", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const open = await modules.issues.createIssue({
			title: "Open issue",
			body: "Body.",
		});
		const closed = await modules.issues.createIssue({
			title: "Closed issue",
			body: "Body.",
		});
		await modules.issues.closeIssue(closed.id);

		const closedIssues = await modules.issues.listIssues({ state: "closed" });
		expect(closedIssues.map((issue) => issue.id)).toEqual([closed.id]);

		const all = await modules.issues.listIssues({ state: "any" });
		expect(new Set(all.map((issue) => issue.id))).toEqual(
			new Set([open.id, closed.id]),
		);
	});

	it("filters by all-of labels", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const a = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const b = await modules.issues.createIssue({
			title: "Triage and bug",
			body: "Body.",
			labels: ["needs-triage", "bug"],
		});
		await modules.issues.createIssue({
			title: "Just bug",
			body: "Body.",
			labels: ["bug"],
		});

		const issues = await modules.issues.listIssues({ labels: ["needs-triage"] });
		expect(issues.map((issue) => issue.id).toSorted()).toEqual(
			[a.id, b.id].toSorted(),
		);

		const both = await modules.issues.listIssues({
			labels: ["needs-triage", "bug"],
		});
		expect(both.map((issue) => issue.id)).toEqual([b.id]);
	});

	it("exclusively lists unlabeled issues when unlabeled: true", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		const unlabeled = await modules.issues.createIssue({
			title: "Unlabeled",
			body: "Body.",
		});
		await modules.issues.createIssue({
			title: "Labeled",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const issues = await modules.issues.listIssues({ unlabeled: true });
		expect(issues.map((issue) => issue.id)).toEqual([unlabeled.id]);
	});

	it("scopes the list to the tracker's project (does not leak sibling projects)", async () => {
		const gateway = new InMemoryTodoistGateway();
		const adapter = new TodoistPersistenceAdapter(gateway, { projectId: "project-1" });
		const modules = createTrackerModules(adapter);

		// A task in a different project should not appear in this list.
		await gateway.createTask({
			content: "From another project",
			description: "Body.",
			labels: [],
			projectId: "project-2",
		});
		const ours = await modules.issues.createIssue({
			title: "Our project",
			body: "Body.",
		});

		const issues = await modules.issues.listIssues({});
		expect(issues.map((issue) => issue.id)).toEqual([ours.id]);
	});
});
