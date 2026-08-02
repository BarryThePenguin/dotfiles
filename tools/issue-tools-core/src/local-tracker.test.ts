import { mkdtempDisposableSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalMarkdownTracker } from "./local-tracker.ts";
import { parseMapBody } from "./map-body.ts";

function setupDir() {
	return mkdtempDisposableSync(join(tmpdir(), "wayfinder-local-tracker-"));
}

describe("LocalMarkdownTracker", () => {
	it("creates a map and ticket as Markdown files", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
			notes: "Use Todoist subtasks for tickets.",
			notYetSpecified: ["How to represent dependencies visually."],
		});

		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose the first implementation slice",
			type: "grilling",
			question: "What is the smallest useful implementation slice?",
		});

		expect(map).toMatchObject({
			title: "Plan Todoist Wayfinder",
			url: `${map.id}/map.md`,
		});
		expect(map.id).toBe("plan-todoist-wayfinder");
		expect(ticket).toMatchObject({
			id: "plan-todoist-wayfinder/01-choose-the-first-implementation-slice",
			mapId: map.id,
			title: "Choose the first implementation slice",
			type: "grilling",
			url: "issues/01-choose-the-first-implementation-slice.md",
			status: "open",
		});

		const mapBody = await readFile(
			join(rootDir.path, map.id, "map.md"),
			"utf8",
		);
		expect(parseMapBody(mapBody).destination).toBe(
			"A Todoist-backed Wayfinder MVP exists.",
		);

		const ticketBody = await readFile(
			join(
				rootDir.path,
				map.id,
				"issues",
				"01-choose-the-first-implementation-slice.md",
			),
			"utf8",
		);
		expect(ticketBody).toContain("Type: grilling");
		expect(ticketBody).toContain("Status: open");
		expect(ticketBody).not.toContain("Blocked by: None");
		expect(ticketBody).toContain("## Question\n\nWhat is the smallest useful implementation slice?");
	});

	it("accepts a displayed map URL anywhere a map ID is expected", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
		});

		expect(await tracker.getMap(map.url)).toMatchObject({
			id: map.id,
			title: "Plan Todoist Wayfinder",
		});
		expect(await tracker.listChildTickets(map.url)).toEqual([]);
	});

	it("lists only incomplete, unclaimed, unblocked child tickets as frontier", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
		});
		const blocker = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocking decision",
			type: "research",
			question: "What blocks the follow-up?",
		});
		const blocked = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocked decision",
			type: "grilling",
			question: "What should happen after the blocker?",
			blockerIds: [blocker.id],
		});
		const blockedBody = await readFile(
			join(rootDir.path, map.id, "issues", "02-blocked-decision.md"),
			"utf8",
		);
		expect(blockedBody).toContain(
			"## Blocked by:\n\n- [01-blocking-decision](01-blocking-decision.md)",
		);
		expect(blockedBody).not.toContain("Blocked by: 01-blocking-decision");

		const claimed = await tracker.createChildTicket({
			mapId: map.id,
			title: "Already claimed decision",
			type: "task",
			question: "Who owns this?",
		});
		await tracker.claimTicketIfUnclaimed(claimed.id, "agent-1");

		expect(
			(await tracker.listFrontierTickets(map.id)).map((ticket) => ticket.id),
		).toEqual([blocker.id]);

		await tracker.closeTicket(blocker.id);

		expect(
			(await tracker.listFrontierTickets(map.id)).map((ticket) => ticket.id),
		).toEqual([blocked.id]);
	});

	it("claims, comments on, records, and closes a ticket", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose tracker",
			type: "grilling",
			question: "Which tracker owns durable state?",
		});

		const claim = await tracker.claimTicketIfUnclaimed(ticket.id, "agent-1");
		expect(claim.claimed).toBe(true);
		expect(claim.ticket.claimedBy).toBe("agent-1");

		const secondClaim = await tracker.claimTicketIfUnclaimed(
			ticket.id,
			"agent-2",
		);
		expect(secondClaim.claimed).toBe(false);
		expect(secondClaim.ticket.claimedBy).toBe("agent-1");

		await tracker.postComment(ticket.id, "Resolution: use Todoist.");
		await tracker.recordDecision(map.id, {
			title: ticket.title,
			url: ticket.url,
			gist: "Todoist owns durable state.",
		});
		await tracker.recordDecision(map.id, {
			title: "A retried title",
			url: ticket.url,
			gist: "A retried gist must not replace the first one.",
		});
		await tracker.closeTicket(ticket.id);

		const resolvedTicket = await tracker.getTicket(ticket.id);
		expect(resolvedTicket.status).toBe("closed");
		expect(resolvedTicket.answer).toBe("Resolution: use Todoist.");
		const resolvedBody = await readFile(
			join(rootDir.path, map.id, "issues", "01-choose-tracker.md"),
			"utf8",
		);
		expect(resolvedBody).toContain("Type: grilling");
		expect(resolvedBody).toContain("Status: resolved");
		expect(resolvedBody).not.toContain("Blocked by: None");
		expect(resolvedBody).toContain("Claimed by: agent-1");
		expect(resolvedBody).toContain("## Answer\n\nResolution: use Todoist.");
		expect((await tracker.getMap(map.id)).decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		]);
	});

	// -- Generic issue surface -------------------------------------------

	it("creates and reads a generic issue as a Markdown file", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Add a generic issue surface",
			body: "Spec is at /path/to/spec.md.",
			labels: ["needs-triage", "bug"],
		});

		expect(created).toMatchObject({
			title: "Add a generic issue surface",
			url: `${created.id}.md`,
			status: "open",
			labels: ["needs-triage", "bug"],
			comments: [],
		});
		expect(created.body).toBe("Spec is at /path/to/spec.md.");

		const read = await tracker.readIssue(created.id);
		expect(read).toMatchObject({
			id: created.id,
			url: created.url,
			title: created.title,
			body: created.body,
			labels: ["needs-triage", "bug"],
			status: "open",
			comments: [],
		});
		expect(read.createdAt).toBeUndefined();
		expect(read.updatedAt).toBeDefined();
	});

	it("reads a generic issue by its URL", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Untracked question",
			body: "Body.",
		});

		const read = await tracker.readIssue(created.url);
		expect(read.id).toBe(created.id);
	});

	it("treats a file with no Status line as unlabeled", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Unlabeled question",
			body: "Body.",
		});

		expect(created.labels).toEqual([]);
		const body = await readFile(
			join(rootDir.path, `${created.id}.md`),
			"utf8",
		);
		expect(body).not.toMatch(/^Status:/m);
		expect((await tracker.readIssue(created.id)).labels).toEqual([]);
	});

	it("applies and removes labels on a generic issue, mapping the Status line to Issue.labels", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const afterAdd = await tracker.updateIssueLabels(created.id, {
			add: ["bug"],
		});
		expect(afterAdd.labels).toEqual(["needs-triage", "bug"]);
		expect(
			(await tracker.readIssue(created.id)).labels,
		).toEqual(["needs-triage", "bug"]);

		const afterRemove = await tracker.updateIssueLabels(created.id, {
			remove: ["needs-triage"],
		});
		expect(afterRemove.labels).toEqual(["bug"]);

		const body = await readFile(
			join(rootDir.path, `${created.id}.md`),
			"utf8",
		);
		expect(body).toContain("Status: bug");
		expect(body).not.toContain("needs-triage");
	});

	it("preserves wayfinder: labels across a triage state transition", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Map parent",
			body: "Body.",
			labels: ["wayfinder_map", "needs-triage"],
		});

		const after = await tracker.updateIssueLabels(created.id, {
			add: ["ready-for-agent"],
			remove: ["needs-triage"],
		});

		expect(after.labels).toEqual(["wayfinder_map", "ready-for-agent"]);
	});

	it("makes remove win when the same label is in both add and remove", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Tricky",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const after = await tracker.updateIssueLabels(created.id, {
			add: ["needs-triage"],
			remove: ["needs-triage"],
		});

		expect(after.labels).toEqual([]);
		expect(
			(await tracker.readIssue(created.id)).labels,
		).toEqual([]);
	});

	it("clears the Status line when removing the last label", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		await tracker.updateIssueLabels(created.id, {
			remove: ["needs-triage"],
		});

		const body = await readFile(
			join(rootDir.path, `${created.id}.md`),
			"utf8",
		);
		expect(body).not.toMatch(/^Status:/m);
	});

	// -- issue_comment / issue_close (local) -------------------------------

	it("comments on a generic issue and reads it back", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		const { comment } = await tracker.commentOnIssue(
			created.id,
			"First agent note",
		);
		expect(comment.content).toBe("First agent note");
		expect(comment.postedAt).toBeUndefined();

		const read = await tracker.readIssue(created.id);
		expect(read.comments.map((c) => c.content)).toEqual(["First agent note"]);

		const body = await readFile(
			join(rootDir.path, `${created.id}.md`),
			"utf8",
		);
		expect(body).toContain("## Comments");
		expect(body).toContain("> First agent note");
	});

	it("appends a second comment, preserving the first under ## Comments", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		await tracker.commentOnIssue(created.id, "First agent note");
		await tracker.commentOnIssue(created.id, "Second agent note");

		const read = await tracker.readIssue(created.id);
		expect(read.comments.map((c) => c.content)).toEqual([
			"First agent note",
			"Second agent note",
		]);
	});

	it("closes a generic issue, marking it closed with a Closed line", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const { status } = await tracker.closeIssue(created.id);
		expect(status).toBe("closed");

		const read = await tracker.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.labels).toEqual(["needs-triage"]);
		const body = await readFile(
			join(rootDir.path, `${created.id}.md`),
			"utf8",
		);
		expect(body).toMatch(/^Closed:/m);
	});

	it("closes with an optional comment that lands under ## Comments", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const created = await tracker.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["wontfix"],
		});

		const { status } = await tracker.closeIssue(created.id, {
			comment: "Won't fix in this milestone.",
		});
		expect(status).toBe("closed");

		const read = await tracker.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.comments.map((c) => c.content)).toEqual([
			"Won't fix in this milestone.",
		]);
	});

	// -- issue_list (local) -----------------------------------------------

	it("lists open issues by default, oldest first, with status on every row", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const first = await tracker.createIssue({
			title: "First issue",
			body: "Body.",
		});
		// Force a different mtime so the sort is deterministic.
		await new Promise((resolve) => setTimeout(resolve, 10));
		const second = await tracker.createIssue({
			title: "Second issue",
			body: "Body.",
		});
		await tracker.closeIssue(second.id);

		const issues = await tracker.listIssues({});
		expect(issues.map((issue) => issue.id)).toEqual([first.id]);
		expect(issues.every((issue) => issue.status === "open")).toBe(true);
	});

	it("lists closed issues when state is 'closed'", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const open = await tracker.createIssue({
			title: "Open issue",
			body: "Body.",
		});
		const closed = await tracker.createIssue({
			title: "Closed issue",
			body: "Body.",
		});
		await tracker.closeIssue(closed.id);

		const issues = await tracker.listIssues({ state: "closed" });
		expect(issues.map((issue) => issue.id)).toEqual([closed.id]);
		expect(issues[0]?.status).toBe("closed");
		expect(issues.find((issue) => issue.id === open.id)).toBeUndefined();
	});

	it("lists all issues when state is 'any'", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const open = await tracker.createIssue({
			title: "Open issue",
			body: "Body.",
		});
		const closed = await tracker.createIssue({
			title: "Closed issue",
			body: "Body.",
		});
		await tracker.closeIssue(closed.id);

		const issues = await tracker.listIssues({ state: "any" });
		expect(new Set(issues.map((issue) => issue.id))).toEqual(
			new Set([open.id, closed.id]),
		);
	});

	it("filters by all-of labels", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const needsTriage = await tracker.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const needsTriageAndBug = await tracker.createIssue({
			title: "Triage and bug",
			body: "Body.",
			labels: ["needs-triage", "bug"],
		});
		await tracker.createIssue({
			title: "Just bug",
			body: "Body.",
			labels: ["bug"],
		});

		const issues = await tracker.listIssues({ labels: ["needs-triage"] });
		expect(issues.map((issue) => issue.id).toSorted()).toEqual(
			[needsTriage.id, needsTriageAndBug.id].toSorted(),
		);

		const both = await tracker.listIssues({
			labels: ["needs-triage", "bug"],
		});
		expect(both.map((issue) => issue.id)).toEqual([needsTriageAndBug.id]);
	});

	it("exclusively lists unlabeled issues when unlabeled: true", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		const unlabeled = await tracker.createIssue({
			title: "Unlabeled",
			body: "Body.",
		});
		await tracker.createIssue({
			title: "Labeled",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const issues = await tracker.listIssues({ unlabeled: true });
		expect(issues.map((issue) => issue.id)).toEqual([unlabeled.id]);
	});

	it("treats unlabeled as exclusive: a labeled issue is not unlabeled even with state: any", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);

		await tracker.createIssue({
			title: "Labeled",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const unlabeled = await tracker.createIssue({
			title: "Unlabeled",
			body: "Body.",
		});

		const issues = await tracker.listIssues({
			state: "any",
			unlabeled: true,
		});
		expect(issues.map((issue) => issue.id)).toEqual([unlabeled.id]);
	});
});
