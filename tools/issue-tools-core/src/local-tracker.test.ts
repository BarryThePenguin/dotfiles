import { mkdtempDisposableSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMapBody } from "./map-body.ts";
import { createLocalTrackerModules } from "./local-tracker-factory.ts";

function setupDir() {
	return mkdtempDisposableSync(join(tmpdir(), "wayfinder-local-tracker-"));
}

describe("LocalMarkdownAdapter", () => {
	it("builds independent Issue and Wayfinder modules over one local store", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const issue = await modules.issues.createIssue({
			title: "Shared local store",
			labels: ["task"],
		});
		const map = await modules.wayfinder.createMap({
			title: "Shared local map",
			destination: "Both domain surfaces use the same local tracker.",
		});

		expect((await modules.issues.readIssue(issue.id)).labels).toEqual(["task"]);
		expect(
			(await modules.wayfinder.listMaps()).map((entry) => entry.id),
		).toEqual([map.id]);
	});

	it("creates a map and ticket as Markdown files", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
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
		expect(ticketBody).toContain(
			"## Question\n\nWhat is the smallest useful implementation slice?",
		);
	});

	it("accepts a displayed map URL anywhere a map ID is expected", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
		});

		const detail = await tracker.getMapDetail(map.url);
		expect(detail.map).toMatchObject({
			id: map.id,
			title: "Plan Todoist Wayfinder",
		});
		expect(detail.frontier).toEqual([]);
		expect(detail.openCount).toBe(0);
	});

	it("lists only incomplete, unclaimed, unblocked child tickets as frontier", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
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
			(await tracker.getMapDetail(map.id)).frontier.map((ticket) => ticket.id),
		).toEqual([blocker.id]);

		await tracker.resolveTicket({
			ticketId: blocker.id,
			mapId: map.id,
			resolution: "Blocking work is complete.",
			gist: "The blocker is resolved.",
		});

		expect(
			(await tracker.getMapDetail(map.id)).frontier.map((ticket) => ticket.id),
		).toEqual([blocked.id]);
	});

	it("claims, resolves, records, and reads a ticket", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
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

		const result = await tracker.resolveTicket({
			ticketId: ticket.id,
			mapId: map.id,
			resolution: "Resolution: use Todoist.",
			gist: "Todoist owns durable state.",
		});
		expect(result.outcome).toBe("complete");

		const resolvedTicket = (await tracker.getTicketDetail(ticket.id)).ticket;
		expect(resolvedTicket.status).toBe("closed");
		expect(resolvedTicket.comments).toEqual(["Resolution: use Todoist."]);
		const resolvedBody = await readFile(
			join(rootDir.path, map.id, "issues", "01-choose-tracker.md"),
			"utf8",
		);
		expect(resolvedBody).toContain("Type: grilling");
		expect(resolvedBody).toContain("Status: resolved");
		expect(resolvedBody).not.toContain("Blocked by: None");
		expect(resolvedBody).toContain("Claimed by: agent-1");
		expect(resolvedBody).toContain("## Answer\n\nResolution: use Todoist.");
		expect((await tracker.getMapDetail(map.id)).map.decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		]);
	});

	it("claim and unclaim move only the Claimed by header, never the Status", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
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
		const ticketPath = join(
			rootDir.path,
			map.id,
			"issues",
			"01-choose-tracker.md",
		);

		await tracker.claimTicketIfUnclaimed(ticket.id, "agent-1");
		let body = await readFile(ticketPath, "utf8");
		expect(body).toContain("Status: open");
		expect(body).toContain("Claimed by: agent-1");

		await tracker.unclaimTicket(ticket.id);
		body = await readFile(ticketPath, "utf8");
		expect(body).toContain("Status: open");
		expect(body).not.toContain("Claimed by:");
		expect(
			(await tracker.getTicketDetail(ticket.id)).ticket.claimedBy,
		).toBeUndefined();
	});

	it("unclaiming a closed ticket leaves it closed", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
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

		await tracker.claimTicketIfUnclaimed(ticket.id, "agent-1");
		await tracker.resolveTicket({
			ticketId: ticket.id,
			mapId: map.id,
			resolution: "The ticket is complete.",
			gist: "Closed tickets can be unclaimed.",
		});
		expect((await tracker.getTicketDetail(ticket.id)).ticket.status).toBe(
			"closed",
		);

		await tracker.unclaimTicket(ticket.id);
		expect((await tracker.getTicketDetail(ticket.id)).ticket.status).toBe(
			"closed",
		);
	});

	it("rejects a ticket file with an unknown Status", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
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
		const ticketPath = join(
			rootDir.path,
			map.id,
			"issues",
			"01-choose-tracker.md",
		);
		const original = await readFile(ticketPath, "utf8");
		await writeFile(
			ticketPath,
			original.replace("Status: open", "Status: in-progress"),
		);

		await expect(tracker.getTicketDetail(ticket.id)).rejects.toThrow(
			"Invalid Wayfinder ticket Status",
		);
	});

	it("rejects a legacy claimed Status", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);
		const tracker = modules.wayfinder;
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
		const ticketPath = join(
			rootDir.path,
			map.id,
			"issues",
			"01-choose-tracker.md",
		);
		const original = await readFile(ticketPath, "utf8");
		await writeFile(
			ticketPath,
			original.replace("Status: open", "Status: claimed"),
		);

		await expect(tracker.getTicketDetail(ticket.id)).rejects.toThrow(
			"Invalid Wayfinder ticket Status",
		);
	});

	// -- Generic issue surface -------------------------------------------

	it("creates and reads a generic issue as a Markdown file", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
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

		const read = await modules.issues.readIssue(created.id);
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
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Untracked question",
			body: "Body.",
		});

		const read = await modules.issues.readIssue(created.url);
		expect(read.id).toBe(created.id);
	});

	it("treats a file with no Status line as unlabeled", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Unlabeled question",
			body: "Body.",
		});

		expect(created.labels).toEqual([]);
		const body = await readFile(join(rootDir.path, `${created.id}.md`), "utf8");
		expect(body).not.toMatch(/^Status:/m);
		expect((await modules.issues.readIssue(created.id)).labels).toEqual([]);
	});

	it("applies and removes labels on a generic issue, mapping the Status line to Issue.labels", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const afterAdd = await modules.issues.updateIssueLabels(created.id, {
			add: ["bug"],
		});
		expect(afterAdd.labels).toEqual(["needs-triage", "bug"]);
		expect((await modules.issues.readIssue(created.id)).labels).toEqual([
			"needs-triage",
			"bug",
		]);

		const afterRemove = await modules.issues.updateIssueLabels(created.id, {
			remove: ["needs-triage"],
		});
		expect(afterRemove.labels).toEqual(["bug"]);

		const body = await readFile(join(rootDir.path, `${created.id}.md`), "utf8");
		expect(body).toContain("Status: bug");
		expect(body).not.toContain("needs-triage");
	});

	it("preserves wayfinder: labels across a triage state transition", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

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

	it("makes remove win when the same label is in both add and remove", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

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
		expect((await modules.issues.readIssue(created.id)).labels).toEqual([]);
	});

	it("clears the Status line when removing the last label", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		await modules.issues.updateIssueLabels(created.id, {
			remove: ["needs-triage"],
		});

		const body = await readFile(join(rootDir.path, `${created.id}.md`), "utf8");
		expect(body).not.toMatch(/^Status:/m);
	});

	// -- issue_comment / issue_close (local) -------------------------------

	it("comments on a generic issue and reads it back", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		const { comment } = await modules.issues.commentOnIssue(
			created.id,
			"First agent note",
		);
		expect(comment.content).toBe("First agent note");
		expect(comment.postedAt).toBeUndefined();

		const read = await modules.issues.readIssue(created.id);
		expect(read.comments.map((c) => c.content)).toEqual(["First agent note"]);

		const body = await readFile(join(rootDir.path, `${created.id}.md`), "utf8");
		expect(body).toContain("## Comments");
		expect(body).toContain("> First agent note");
	});

	it("appends a second comment, preserving the first under ## Comments", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		await modules.issues.commentOnIssue(created.id, "First agent note");
		await modules.issues.commentOnIssue(created.id, "Second agent note");

		const read = await modules.issues.readIssue(created.id);
		expect(read.comments.map((c) => c.content)).toEqual([
			"First agent note",
			"Second agent note",
		]);
	});

	it("closes a generic issue, marking it closed with a Closed line", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const { status } = await modules.issues.closeIssue(created.id);
		expect(status).toBe("closed");

		const read = await modules.issues.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.labels).toEqual(["needs-triage"]);
		const body = await readFile(join(rootDir.path, `${created.id}.md`), "utf8");
		expect(body).toMatch(/^Closed:/m);
	});

	it("closes with an optional comment that lands under ## Comments", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const created = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["wontfix"],
		});

		const { status } = await modules.issues.closeIssue(created.id, {
			comment: "Won't fix in this milestone.",
		});
		expect(status).toBe("closed");

		const read = await modules.issues.readIssue(created.id);
		expect(read.status).toBe("closed");
		expect(read.comments.map((c) => c.content)).toEqual([
			"Won't fix in this milestone.",
		]);
	});

	// -- issue_list (local) -----------------------------------------------

	it("lists open issues by default, oldest first, with status on every row", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const first = await modules.issues.createIssue({
			title: "First issue",
			body: "Body.",
		});
		// Force a different mtime so the sort is deterministic.
		await new Promise((resolve) => setTimeout(resolve, 10));
		const second = await modules.issues.createIssue({
			title: "Second issue",
			body: "Body.",
		});
		await modules.issues.closeIssue(second.id);

		const issues = await modules.issues.listIssues({});
		expect(issues.map((issue) => issue.id)).toEqual([first.id]);
		expect(issues.every((issue) => issue.status === "open")).toBe(true);
	});

	it("lists closed issues when state is 'closed'", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const open = await modules.issues.createIssue({
			title: "Open issue",
			body: "Body.",
		});
		const closed = await modules.issues.createIssue({
			title: "Closed issue",
			body: "Body.",
		});
		await modules.issues.closeIssue(closed.id);

		const issues = await modules.issues.listIssues({ state: "closed" });
		expect(issues.map((issue) => issue.id)).toEqual([closed.id]);
		expect(issues[0]?.status).toBe("closed");
		expect(issues.find((issue) => issue.id === open.id)).toBeUndefined();
	});

	it("lists all issues when state is 'any'", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const open = await modules.issues.createIssue({
			title: "Open issue",
			body: "Body.",
		});
		const closed = await modules.issues.createIssue({
			title: "Closed issue",
			body: "Body.",
		});
		await modules.issues.closeIssue(closed.id);

		const issues = await modules.issues.listIssues({ state: "any" });
		expect(new Set(issues.map((issue) => issue.id))).toEqual(
			new Set([open.id, closed.id]),
		);
	});

	it("filters by all-of labels", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		const needsTriage = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const needsTriageAndBug = await modules.issues.createIssue({
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
			[needsTriage.id, needsTriageAndBug.id].toSorted(),
		);

		const both = await modules.issues.listIssues({
			labels: ["needs-triage", "bug"],
		});
		expect(both.map((issue) => issue.id)).toEqual([needsTriageAndBug.id]);
	});

	it("exclusively lists unlabeled issues when unlabeled: true", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

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

	it("treats unlabeled as exclusive: a labeled issue is not unlabeled even with state: any", async () => {
		using rootDir = setupDir();
		const modules = createLocalTrackerModules(rootDir.path);

		await modules.issues.createIssue({
			title: "Labeled",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const unlabeled = await modules.issues.createIssue({
			title: "Unlabeled",
			body: "Body.",
		});

		const issues = await modules.issues.listIssues({
			state: "any",
			unlabeled: true,
		});
		expect(issues.map((issue) => issue.id)).toEqual([unlabeled.id]);
	});
});
