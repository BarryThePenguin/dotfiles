import { mkdtempDisposableSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createInMemorySessionStateStore,
	createLocalTrackerModules,
	createTrackerSession,
} from "issue-tools-core";
import { handleAction, type ToolContext } from "./actions.ts";

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "wayfinder-actions-"));
}

function makeContext(cwd: string) {
	const store = createInMemorySessionStateStore();
	const updateStatus = vi.fn();
	const trackerSession = createTrackerSession({
		cwd,
		selectMode: () => Promise.resolve("local"),
		buildLocalModules: () => createLocalTrackerModules(cwd),
		buildTodoistModules: vi.fn(),
		store,
		updateStatus,
	});
	const toolContext: ToolContext = { trackerSession };
	return { toolContext, store, updateStatus };
}

describe("Wayfinder actions", () => {
	it("makes the only listed map active so follow-up map tools can omit map_id", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const tracker = modules.wayfinder;
		const map = await tracker.createMap({
			title: "GENIE 2780",
			destination: "A clear handoff exists.",
		});
		const { store, toolContext, updateStatus } = makeContext(dir.path);

		const listResult = await handleAction("list_maps", {}, toolContext);
		expect(listResult.content[0]?.text).toContain("1 open map(s)");
		expect(listResult.content[0]?.text).toContain(`[${map.title}](${map.url})`);
		expect(toolContext.trackerSession.getActiveMap()).toBe(map.id);
		expect(store.read().activeMap).toBe(map.id);
		expect(updateStatus).toHaveBeenCalledWith({
			mode: "local",
			activeMap: map.id,
			cwd: dir.path,
		});

		const getResult = await handleAction("get_map", {}, toolContext);
		expect(getResult.content[0]?.text).toContain("## GENIE 2780");
		expect(getResult.content[0]?.text).not.toContain(
			"Error: no map_id provided and no active map.",
		);
	});
});

describe("Wayfinder presentation and claims", () => {
	it("puts ticket names first and claims for the dev driving the map", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const tracker = modules.wayfinder;
		const map = await tracker.createMap({
			title: "Presentation map",
			destination: "Ticket names are clear.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose the naming rule",
			type: "task",
			question: "Which name should appear first?",
		});
		const { toolContext } = makeContext(dir.path);
		vi.stubEnv("PI_ISSUE_TOOLS_CLAIMANT", "Jonathan Haines");

		const frontier = await handleAction(
			"list_frontier",
			{ map_id: map.id },
			toolContext,
		);
		const frontierText = frontier.content[0]?.text ?? "";
		expect(frontierText).toContain(`Choose the naming rule (${ticket.id})`);
		expect(frontierText.indexOf(ticket.title)).toBeLessThan(
			frontierText.indexOf(ticket.id),
		);

		try {
			await handleAction("claim", { ticket_id: ticket.id }, toolContext);
		} finally {
			vi.unstubAllEnvs();
		}
		expect((await tracker.getTicketDetail(ticket.id)).ticket.claimedBy).toBe(
			"Jonathan Haines",
		);
	});
});

describe("Resolution actions", () => {
	it("renders complete and terminal outcomes without using the active map", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const tracker = modules.wayfinder;
		const map = await tracker.createMap({
			title: "Resolution map",
			destination: "A decision is recorded after closure.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose a path",
			type: "task",
			question: "Which path wins?",
		});
		const dependent = await tracker.createChildTicket({
			mapId: map.id,
			title: "Apply the chosen path",
			type: "task",
			question: "How should the choice be applied?",
		});
		await tracker.setBlockingDependencies(dependent.id, [ticket.id]);
		const { toolContext } = makeContext(dir.path);
		toolContext.trackerSession.setActiveMap("wrong-map");

		const complete = await handleAction(
			"resolve",
			{
				map_id: map.id,
				ticket_id: ticket.id,
				resolution: "Take path A.",
				gist: "Take path A.",
			},
			toolContext,
		);
		expect(complete.content[0]?.text).toContain("Outcome: complete");
		expect(complete.content[0]?.text).toContain("map decision recorded");
		expect(complete.content[0]?.text).toContain(
			`Unblocked tickets: ${dependent.title} (${dependent.id})`,
		);

		const ticketDetails = await handleAction(
			"get_ticket",
			{ ticket_id: ticket.id },
			toolContext,
		);
		expect(ticketDetails.content[0]?.text).toContain("Comments (1)");
		expect(ticketDetails.content[0]?.text).toContain("Take path A.");
		expect(ticketDetails.content[0]?.text).not.toContain("Answer");

		const closed = await tracker.createChildTicket({
			mapId: map.id,
			title: "Already closed",
			type: "research",
			question: "What happened?",
		});
		const closedPath = join(dir.path, map.id, closed.url);
		const closedBody = await readFile(closedPath, "utf8");
		await writeFile(
			closedPath,
			closedBody.replace("Status: open", "Status: resolved"),
		);
		const terminal = await handleAction(
			"resolve",
			{
				map_id: map.id,
				ticket_id: closed.id,
				resolution: "Too late.",
				gist: "Inspect it.",
			},
			toolContext,
		);
		expect(terminal.content[0]?.text).toContain("Outcome: terminal");
		expect(terminal.content[0]?.text).toContain("Human inspection is required");
	});
});

describe("Generic issue actions", () => {
	it("creates and reads a generic issue end-to-end on the local tracker", async () => {
		using dir = tempDir();
		const { toolContext } = makeContext(dir.path);

		const createResult = await handleAction(
			"issue_create",
			{
				title: "Add a generic issue surface",
				body: "Spec is at /path/to/spec.md.",
				labels: ["needs-triage", "bug"],
			},
			toolContext,
		);
		expect(createResult.content[0]?.text).toContain(
			"Issue created: Add a generic issue surface",
		);
		const idMatch = /ID: (\S+)/.exec(createResult.content[0]?.text ?? "");
		const issueId = idMatch?.[1];
		expect(issueId).toBeDefined();

		const readResult = await handleAction(
			"issue_read",
			{ id: issueId ?? "" },
			toolContext,
		);
		expect(readResult.content[0]?.text).toContain(
			"## Add a generic issue surface",
		);
		expect(readResult.content[0]?.text).toContain("Status: open");
		expect(readResult.content[0]?.text).toContain("Labels: needs-triage, bug");
		expect(readResult.content[0]?.text).toContain(
			"Spec is at /path/to/spec.md.",
		);

		const readByUrl = await handleAction(
			"issue_read",
			{ id: `${issueId}.md` },
			toolContext,
		);
		expect(readByUrl.content[0]?.text).toContain(
			"## Add a generic issue surface",
		);
	});

	it("reads a generic issue by its URL", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Untracked question",
			body: "Body.",
		});

		const { toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_read",
			{ id: issue.url },
			toolContext,
		);
		expect(result.content[0]?.text).toContain("## Untracked question");
	});

	it("applies and removes labels via issue_label and returns the resulting set", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const { toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_label",
			{
				id: issue.id,
				add: ["bug"],
				remove: ["needs-triage"],
			},
			toolContext,
		);
		expect(result.content[0]?.text).toContain(
			`Issue ${issue.id}: labels now bug`,
		);
	});

	it("posts a comment via issue_comment and reports the post", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		const { toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_comment",
			{ id: issue.id, body: "First agent note" },
			toolContext,
		);
		expect(result.content[0]?.text).toContain("Comment posted on");
	});

	it("closes an issue via issue_close with an optional closing note", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["wontfix"],
		});

		const { toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_close",
			{ id: issue.id, comment: "Won't fix in this milestone." },
			toolContext,
		);
		expect(result.content[0]?.text).toContain(
			`Issue ${issue.id}: closed (closing note posted)`,
		);

		const after = await issues.readIssue(issue.id);
		expect(after.status).toBe("closed");
		expect(after.comments.map((c) => c.content)).toEqual([
			"Won't fix in this milestone.",
		]);
	});

	it("lists issues via issue_list with state/labels/unlabeled filters", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const issues = modules.issues;

		const unlabeled = await issues.createIssue({
			title: "Unlabeled",
			body: "Body.",
		});
		await issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const closed = await issues.createIssue({
			title: "Closed triage",
			body: "Body.",
			labels: ["needs-triage"],
		});
		await issues.closeIssue(closed.id);

		const { toolContext } = makeContext(dir.path);

		const openTriage = await handleAction(
			"issue_list",
			{ labels: ["needs-triage"] },
			toolContext,
		);
		expect(openTriage.content[0]?.text).toContain("1 issue(s)");
		expect(openTriage.content[0]?.text).toContain("Triage me");

		const unlabeledResult = await handleAction(
			"issue_list",
			{ unlabeled: true },
			toolContext,
		);
		expect(unlabeledResult.content[0]?.text).toContain(unlabeled.id);
		expect(unlabeledResult.content[0]?.text).not.toContain("Triage me");

		const closedResult = await handleAction(
			"issue_list",
			{ state: "closed" },
			toolContext,
		);
		expect(closedResult.content[0]?.text).toContain("Closed triage");
		expect(closedResult.content[0]?.text).toContain("[closed]");
	});
});
