import { addTask, addTaskComment, completeTask, Database } from "doist-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TODOIST_TICKET_TYPE_LABELS, WAYFINDER_MAP_LABEL } from "./labels.ts";
import {
	IssueModule,
	WayfinderModule,
	type TrackerModules,
} from "./modules.ts";
import {
	createTodoistFixture,
	type TodoistTestFixture,
} from "./test-helpers/todoist-fixture.ts";

function modulesFor(fixture: TodoistTestFixture): TrackerModules {
	return {
		issues: new IssueModule(fixture.adapter),
		wayfinder: new WayfinderModule({
			persistence: fixture.adapter,
			resolutionPersistence: fixture.adapter,
		}),
	};
}

describe("TodoistAdapter", () => {
	let fixture: TodoistTestFixture;
	let modules: TrackerModules;

	beforeEach(() => {
		fixture = createTodoistFixture({ projectId: "project-1" });
		modules = modulesFor(fixture);
	});

	afterEach(() => {
		fixture.cleanup();
	});

	it("creates a map task and ticket subtasks using Todoist labels", async () => {
		const map = await modules.wayfinder.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
			notes: "Use subtasks as tickets.",
		});
		const ticket = await modules.wayfinder.createChildTicket({
			mapId: map.id,
			title: "Choose dependency representation",
			type: "grilling",
			question: "How should blockers be represented?",
		});

		expect(fixture.client.tasks.get(map.id)).toMatchObject({
			content: "Plan Todoist Wayfinder",
			project_id: "project-1",
			labels: JSON.stringify([WAYFINDER_MAP_LABEL]),
		});
		const ticketTask = fixture.client.tasks.get(ticket.id);
		expect(ticketTask).toMatchObject({
			content: "Choose dependency representation",
			parent_id: map.id,
			labels: JSON.stringify([TODOIST_TICKET_TYPE_LABELS.grilling]),
		});
		expect(ticketTask?.description).not.toContain("wayfinder:map");
		expect(ticket).toMatchObject({
			mapId: map.id,
			type: "grilling",
			status: "open",
		});
	});

	it("lists only incomplete maps using the SQL label filter", async () => {
		const map = await modules.wayfinder.createMap({
			title: "Included map",
			destination: "This map should be listed.",
		});
		const completedMap = await modules.wayfinder.createMap({
			title: "Completed map",
			destination: "This map should not be listed.",
		});
		await completeTask(
			{ db: fixture.db, client: fixture.client },
			completedMap.id,
		);
		await modules.issues.createIssue({
			title: "Not a map",
			body: "This task has no wayfinder_map label.",
		});

		const selectTasks = vi.spyOn(fixture.db, "selectTasks");
		const selectTasksWithNotes = vi.spyOn(fixture.db, "selectTasksWithNotes");

		const maps = await modules.wayfinder.listMaps();

		expect(maps.map((listedMap) => listedMap.id)).toEqual([map.id]);
		expect(selectTasks).toHaveBeenCalledExactlyOnceWith({
			completed: "incomplete",
			label: WAYFINDER_MAP_LABEL,
		});
		expect(selectTasksWithNotes).not.toHaveBeenCalled();
	});

	it("uses the Todoist parent relationship as the ticket's map id", async () => {
		const map = await modules.wayfinder.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const ticket = await modules.wayfinder.createChildTicket({
			mapId: map.id,
			title: "Choose relationship source",
			type: "grilling",
			question: "Where should map identity come from?",
		});

		const task = fixture.client.tasks.get(ticket.id);
		expect(task?.parent_id).toBe(map.id);
		expect(task?.description).not.toContain("wayfinder:map");
		expect(
			(await modules.wayfinder.getTicketDetail(ticket.id)).ticket,
		).toMatchObject({
			mapId: map.id,
		});
	});

	it("lists frontier tickets using completion, claim metadata, and blocker metadata", async () => {
		const map = await modules.wayfinder.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const blocker = await modules.wayfinder.createChildTicket({
			mapId: map.id,
			title: "Blocking research",
			type: "research",
			question: "What blocks the next decision?",
		});
		const blocked = await modules.wayfinder.createChildTicket({
			mapId: map.id,
			title: "Blocked decision",
			type: "grilling",
			question: "What follows research?",
			blockerIds: [blocker.id],
		});
		expect(fixture.client.tasks.get(blocked.id)?.description).toContain(
			`## Blocked by:\n\n- [Blocking research](${blocker.url})`,
		);
		expect(fixture.client.tasks.get(blocked.id)?.description).not.toContain(
			"wayfinder:blocked-by",
		);
		const claimed = await modules.wayfinder.createChildTicket({
			mapId: map.id,
			title: "Claimed decision",
			type: "task",
			question: "Who owns this?",
		});
		await modules.wayfinder.claimTicketIfUnclaimed(claimed.id, "agent-1");

		expect(
			(await modules.wayfinder.getMapDetail(map.id)).frontier.map(
				(ticket) => ticket.id,
			),
		).toEqual([blocker.id]);

		await modules.wayfinder.resolveTicket({
			ticketId: blocker.id,
			mapId: map.id,
			resolution: "Blocking work is complete.",
			gist: "The blocker is resolved.",
		});

		expect(
			(await modules.wayfinder.getMapDetail(map.id)).frontier.map(
				(ticket) => ticket.id,
			),
		).toEqual([blocked.id]);
	});

	it("claims, resolves, records, and reads Todoist tickets", async () => {
		const map = await modules.wayfinder.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const ticket = await modules.wayfinder.createChildTicket({
			mapId: map.id,
			title: "Choose tracker",
			type: "grilling",
			question: "Which tracker owns durable state?",
		});

		expect(
			await modules.wayfinder.claimTicketIfUnclaimed(ticket.id, "agent-1"),
		).toMatchObject({ claimed: true, ticket: { claimedBy: "agent-1" } });
		const claimedDescription =
			fixture.client.tasks.get(ticket.id)?.description ?? "";
		expect(claimedDescription).toContain("Claimed by: agent-1");
		expect(claimedDescription).not.toContain("wayfinder:claimed-by");
		expect(
			await modules.wayfinder.claimTicketIfUnclaimed(ticket.id, "agent-2"),
		).toMatchObject({ claimed: false, ticket: { claimedBy: "agent-1" } });

		const result = await modules.wayfinder.resolveTicket({
			ticketId: ticket.id,
			mapId: map.id,
			resolution: "Resolution: use Todoist.",
			gist: "Todoist owns durable state.",
		});
		expect(result.outcome).toBe("complete");

		expect(
			(await modules.wayfinder.getTicketDetail(ticket.id)).ticket,
		).toMatchObject({
			status: "closed",
			comments: ["Resolution: use Todoist."],
		});

		await modules.wayfinder.unclaimTicket(ticket.id);
		const unclaimedDescription =
			fixture.client.tasks.get(ticket.id)?.description ?? "";
		expect(unclaimedDescription).not.toContain("Claimed by:");
		expect(unclaimedDescription).not.toContain("wayfinder:claimed-by");
		expect(
			(await modules.wayfinder.getMapDetail(map.id)).map.decisionsSoFar,
		).toEqual([
			{
				title: "Choose tracker",
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		]);
	});

	it("keeps historical Todoist comments native on fresh ticket reads", async () => {
		const map = await modules.wayfinder.createMap({
			title: "Historical comments",
			destination: "Existing comments retain their tracker meaning.",
		});
		const ticket = await modules.wayfinder.createChildTicket({
			mapId: map.id,
			title: "Read old comments",
			type: "research",
			question: "Are old comments still ordinary comments?",
		});

		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			ticket.id,
			"Historical note",
		);

		expect(
			(await modules.wayfinder.getTicketDetail(ticket.id)).ticket,
		).toMatchObject({
			comments: ["Historical note"],
		});
	});

	// -- Generic issue surface -------------------------------------------

	it("creates and reads a generic issue over the doist-core engine", async () => {
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
		expect(fixture.client.tasks.get(created.id)).toMatchObject({
			content: "Add a generic issue surface",
			description: "Spec is at /path/to/spec.md.",
			labels: JSON.stringify(["needs-triage", "bug"]),
			project_id: "project-1",
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

	it("reads a generic issue by its Todoist slug URL", async () => {
		const created = await modules.issues.createIssue({
			title: "Untracked question",
			body: "Body.",
		});

		const slugUrl = `https://app.todoist.com/app/task/untracked-question-${created.id}`;
		const read = await modules.issues.readIssue(slugUrl);
		expect(read.id).toBe(created.id);
	});

	// -- Label delta contract (issue_label) -------------------------------

	it("updateIssueLabels applies delta addLabels in one round trip with the set-merged result on the wire", async () => {
		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			created.id,
			"Existing",
		);
		const nestedSpy = vi.spyOn(Database.prototype, "getTaskWithNotes");

		fixture.client.syncCalls.length = 0;
		const after = await modules.issues.updateIssueLabels(created.id, {
			add: ["bug"],
		});

		expect(after.labels).toEqual(["needs-triage", "bug"]);
		expect(after.comments.map((comment) => comment.content)).toEqual([
			"Existing",
		]);
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith(created.id);
		// One sync carried the update; the Todoist API only accepts an absolute
		// label set, so the set-merged result is on the wire.
		expect(fixture.client.syncCalls).toHaveLength(1);
		expect(fixture.client.syncCalls[0]).toHaveLength(1);
		expect(fixture.client.syncCalls[0]?.[0]).toMatchObject({
			type: "item_update",
			args: { id: created.id, labels: ["needs-triage", "bug"] },
		});
	});

	it("updateIssueLabels with only addLabels is a single round trip", async () => {
		const created = await modules.issues.createIssue({
			title: "Ticket",
			body: "Body.",
			labels: ["urgent"],
		});

		fixture.client.syncCalls.length = 0;
		await modules.issues.updateIssueLabels(created.id, { add: ["new"] });

		expect(fixture.client.syncCalls).toHaveLength(1);
		expect(fixture.client.syncCalls[0]?.[0]?.args).toMatchObject({
			id: created.id,
			labels: ["urgent", "new"],
		});
	});

	it("updateIssueLabels removes the right labels in one round trip", async () => {
		const created = await modules.issues.createIssue({
			title: "Multi-label",
			body: "Body.",
			labels: ["needs-triage", "bug", "home"],
		});

		fixture.client.syncCalls.length = 0;
		const after = await modules.issues.updateIssueLabels(created.id, {
			remove: ["needs-triage", "home"],
		});

		expect(after.labels).toEqual(["bug"]);
		expect(fixture.client.syncCalls).toHaveLength(1);
		expect(fixture.client.syncCalls[0]?.[0]).toMatchObject({
			type: "item_update",
			args: { id: created.id, labels: ["bug"] },
		});
	});

	it("updateIssueLabels is idempotent when addLabels overlap existing labels", async () => {
		const created = await modules.issues.createIssue({
			title: "Ticket",
			body: "Body.",
			labels: ["urgent", "home"],
		});

		const after = await modules.issues.updateIssueLabels(created.id, {
			add: ["home", "work"],
		});

		expect(after.labels).toEqual(["urgent", "home", "work"]);
	});

	it("updateIssueLabels preserves wayfinder: labels across a triage state transition", async () => {
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
		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		const { comment } = await modules.issues.commentOnIssue(
			created.id,
			"First agent note",
		);
		expect(comment.content).toBe("First agent note");
		expect(comment.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

		const read = await modules.issues.readIssue(created.id);
		expect(read.comments).toHaveLength(1);
		expect(read.comments[0]?.content).toBe("First agent note");
		expect(read.comments[0]?.postedAt).toBeDefined();
	});

	it("closes a generic issue with a single close command", async () => {
		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		fixture.client.syncCalls.length = 0;
		const { status } = await modules.issues.closeIssue(created.id);
		expect(status).toBe("closed");
		expect(fixture.client.syncCalls).toHaveLength(1);
		expect(fixture.client.syncCalls[0]).toHaveLength(1);
		expect(fixture.client.syncCalls[0]?.[0]).toMatchObject({
			type: "item_close",
			args: { id: created.id },
		});

		const read = await modules.issues.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.labels).toEqual(["needs-triage"]);
	});

	it("closes with a comment, landing the closing note in one atomic sync", async () => {
		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["wontfix"],
		});

		fixture.client.syncCalls.length = 0;
		const { status } = await modules.issues.closeIssue(created.id, {
			comment: "Closing: wontfix",
		});
		expect(status).toBe("closed");

		// One sync carried both the close and the note add.
		expect(fixture.client.syncCalls).toHaveLength(1);
		const types = (fixture.client.syncCalls[0] ?? [])
			.map((command) => command.type)
			.toSorted();
		expect(types).toEqual(["item_close", "note_add"]);

		const read = await modules.issues.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.comments.map((comment) => comment.content)).toEqual([
			"Closing: wontfix",
		]);
	});

	// -- Timestamps on read ----------------------------------------------

	it("surfaces task createdAt and updatedAt on read", async () => {
		const created = "2026-01-01T12:00:00.000000Z";
		const updated = "2026-02-01T12:00:00.000000Z";
		const timedFixture = createTodoistFixture({
			taskTimestamps: { created, updated },
		});
		try {
			const timedModules = modulesFor(timedFixture);
			const made = await timedModules.issues.createIssue({
				title: "Timed",
				body: "Body.",
			});

			const read = await timedModules.issues.readIssue(made.id);
			expect(read.createdAt).toBe(created);
			expect(read.updatedAt).toBe(updated);
		} finally {
			timedFixture.cleanup();
		}
	});

	// -- issue_list (Todoist) ---------------------------------------------

	it("lists open issues by default, oldest first, with status on every row", async () => {
		const first = await modules.issues.createIssue({
			title: "First issue",
			body: "Body.",
		});
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

		const issues = await modules.issues.listIssues({
			labels: ["needs-triage"],
		});
		expect(issues.map((issue) => issue.id).toSorted()).toEqual(
			[a.id, b.id].toSorted(),
		);

		const both = await modules.issues.listIssues({
			labels: ["needs-triage", "bug"],
		});
		expect(both.map((issue) => issue.id)).toEqual([b.id]);
	});

	it("exclusively lists unlabeled issues when unlabeled: true", async () => {
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
		// A task in a different project should not appear in this list.
		await addTask(
			{ db: fixture.db, client: fixture.client },
			{
				title: "From another project",
				description: "Body.",
				labels: [],
				project: "project-2",
			},
		);
		const ours = await modules.issues.createIssue({
			title: "Our project",
			body: "Body.",
		});

		const issues = await modules.issues.listIssues({});
		expect(issues.map((issue) => issue.id)).toEqual([ours.id]);
	});
});

// ---------------------------------------------------------------------------
// Nested comment reads: comment-bearing reads load notes with their tasks.
// ---------------------------------------------------------------------------

describe("TodoistAdapter nested comment reads", () => {
	let fixture: TodoistTestFixture;

	beforeEach(() => {
		fixture = createTodoistFixture({ projectId: "project-1" });
	});

	afterEach(() => {
		fixture.cleanup();
		vi.restoreAllMocks();
	});

	it("maps fresh creates without rereading the created task or its notes", async () => {
		const taskReadSpy = vi.spyOn(Database.prototype, "getTaskById");
		const nestedReadSpy = vi.spyOn(Database.prototype, "getTaskWithNotes");
		const listReadSpy = vi.spyOn(Database.prototype, "selectTasksWithNotes");
		vi.clearAllMocks();

		const map = await fixture.adapter.createMap({
			title: "Fresh map",
			destination: "Created directly from the write result.",
		});
		const ticket = await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "Fresh ticket",
			type: "task",
			question: "Is the create result sufficient?",
		});
		const issue = await fixture.adapter.createIssueRecord({
			title: "Fresh issue",
			body: "Created directly from the write result.",
		});

		expect(taskReadSpy.mock.calls.map(([id]) => id)).not.toContain(ticket.id);
		expect(taskReadSpy.mock.calls.map(([id]) => id)).not.toContain(issue.id);
		expect(nestedReadSpy).not.toHaveBeenCalled();
		expect(listReadSpy).not.toHaveBeenCalled();
		expect(ticket.comments).toEqual([]);
		expect(issue.comments).toEqual([]);
	});

	it("pins body-only adapter reads to task queries without notes", async () => {
		const map = await fixture.adapter.createMap({
			title: "Body-only map",
			destination: "Only the description is needed.",
		});
		const taskReadSpy = vi.spyOn(Database.prototype, "getTaskById");
		const nestedReadSpy = vi.spyOn(Database.prototype, "selectTasksWithNotes");
		const selectSpy = vi.spyOn(Database.prototype, "selectTasks");

		await fixture.adapter.getMap(map.id);
		await fixture.adapter.writeMapSection(map.id, "notes", "Updated");
		await fixture.adapter.listMaps();

		expect(taskReadSpy).toHaveBeenCalledTimes(2);
		expect(taskReadSpy).toHaveBeenNthCalledWith(1, map.id);
		expect(taskReadSpy).toHaveBeenNthCalledWith(2, map.id);
		expect(selectSpy).toHaveBeenCalledExactlyOnceWith({
			completed: "incomplete",
			label: WAYFINDER_MAP_LABEL,
		});
		expect(nestedReadSpy).not.toHaveBeenCalled();
	});

	it("sets blocking with body-only reads for blockers and the target", async () => {
		const map = await fixture.adapter.createMap({
			title: "Blocking map",
			destination: "Blocking reads.",
		});
		const blocker = await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "Blocker",
			type: "task",
			question: "What blocks this?",
		});
		const target = await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "Target",
			type: "task",
			question: "What is next?",
		});
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			blocker.id,
			"Blocker note",
		);
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			target.id,
			"Target note",
		);

		const nestedSpy = vi.spyOn(Database.prototype, "selectTasksWithNotes");
		const modules = modulesFor(fixture);

		const updated = await modules.wayfinder.setBlockingDependencies(target.id, [
			blocker.id,
		]);

		expect(updated).toMatchObject({
			id: target.id,
			title: "Target",
			blockerIds: [blocker.id],
			comments: [],
		});
		expect(nestedSpy).not.toHaveBeenCalled();
		expect(fixture.client.tasks.get(target.id)?.description).toContain(
			`- [Blocker](${blocker.url})`,
		);
	});

	it("loads a single ticket and its comments in one notes query", async () => {
		const map = await fixture.adapter.createMap({
			title: "Single read map",
			destination: "A single record read.",
		});
		const ticket = await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "Single ticket",
			type: "task",
			question: "Q",
		});
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			ticket.id,
			"Comment",
		);

		const nestedSpy = vi.spyOn(Database.prototype, "selectTasksWithNotes");

		const read = await fixture.adapter.getTicket(ticket.id);

		expect(read.comments).toEqual(["Comment"]);
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith({
			completed: "any",
			id: ticket.id,
		});
	});

	it("loads a single issue and its comments in one notes query", async () => {
		const issue = await fixture.adapter.createIssueRecord({
			title: "Single issue",
			body: "Body.",
		});
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			issue.id,
			"Comment",
		);

		const nestedSpy = vi.spyOn(Database.prototype, "selectTasksWithNotes");

		const read = await fixture.adapter.readIssueRecord(issue.id);

		expect(read.comments.map((comment) => comment.content)).toEqual([
			"Comment",
		]);
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith({
			completed: "any",
			id: issue.id,
		});
	});

	it("loads a map's children and their comments in one notes query", async () => {
		const map = await fixture.adapter.createMap({
			title: "Batch map",
			destination: "Batched reads.",
		});
		await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "One",
			type: "task",
			question: "Q1",
		});
		await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "Two",
			type: "task",
			question: "Q2",
		});

		const nestedSpy = vi.spyOn(Database.prototype, "selectTasksWithNotes");

		const children = await fixture.adapter.listChildTickets(map.id);

		const childrenIds = children.map((ticket) => ticket.id);
		expect(childrenIds).toHaveLength(2);
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith({
			completed: "any",
			parentId: map.id,
		});
	});

	it("loads issues with their comments in one notes query", async () => {
		await fixture.adapter.createIssueRecord({
			title: "Issue A",
			body: "A.",
		});
		await fixture.adapter.createIssueRecord({
			title: "Issue B",
			body: "B.",
		});

		const nestedSpy = vi.spyOn(Database.prototype, "selectTasksWithNotes");

		const issues = await fixture.adapter.listIssueRecords();

		expect(issues).toHaveLength(2);
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith({
			completed: "any",
			projectId: "project-1",
		});
	});

	it("preserves posted_at comment order through the batched read", async () => {
		const map = await fixture.adapter.createMap({
			title: "Order map",
			destination: "Order.",
		});
		const ticket = await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "Order ticket",
			type: "task",
			question: "Q",
		});
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			ticket.id,
			"first",
		);
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			ticket.id,
			"second",
		);

		const children = await fixture.adapter.listChildTickets(map.id);

		expect(children[0]?.comments).toEqual(["first", "second"]);
	});

	it("reuses one nested read across ticket mutations", async () => {
		const map = await fixture.adapter.createMap({
			title: "Mutation map",
			destination: "Mutation reads.",
		});
		const ticket = await fixture.adapter.createChildTicket({
			mapId: map.id,
			title: "Mutation ticket",
			type: "task",
			question: "Q",
		});
		await addTaskComment(
			{ db: fixture.db, client: fixture.client },
			ticket.id,
			"Existing",
		);

		const nestedSpy = vi.spyOn(Database.prototype, "getTaskWithNotes");

		const claimed = await fixture.adapter.claimTicketIfUnclaimed(
			ticket.id,
			"agent-1",
		);
		expect(claimed.ticket.comments).toEqual(["Existing"]);
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith(ticket.id);

		nestedSpy.mockClear();
		const unclaimed = await fixture.adapter.unclaimTicket(ticket.id);
		expect(unclaimed.comments).toEqual(["Existing"]);
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith(ticket.id);

		nestedSpy.mockClear();
		const closed = await fixture.adapter.closeTicket(ticket.id);
		expect(closed.comments).toEqual(["Existing"]);
		expect(closed.status).toBe("closed");
		expect(nestedSpy).toHaveBeenCalledExactlyOnceWith(ticket.id);
	});
});
