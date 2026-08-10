import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtempDisposableSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createLocalTrackerModules,
	createTrackerSession,
	localTrackerRoot,
} from "issue-tools-core";
import { createTrackerModules } from "./index.ts";
import { handleAction, type ToolContext } from "./actions.ts";

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "wayfinder-actions-"));
}

function makeContext(cwd: string) {
	const persistState = vi.fn();
	const updateStatus = vi.fn();
	const trackerSession = createTrackerSession({
		cwd,
		selectMode: () => Promise.resolve("local"),
		buildModules: createTrackerModules,
		persistState,
		updateStatus,
	});
	const toolContext: ToolContext = { trackerSession };
	return {
		toolContext,
		persistState,
		updateStatus,
		extensionContext: { cwd } as ExtensionContext,
	};
}

describe("Wayfinder actions", () => {
	it("makes the only listed map active so follow-up map tools can omit map_id", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const tracker = modules.wayfinder;
		const map = await tracker.createMap({
			title: "GENIE 2780",
			destination: "A clear handoff exists.",
		});
		const { extensionContext, persistState, toolContext, updateStatus } =
			makeContext(dir.path);

		const listResult = await handleAction(
			"list_maps",
			{},
			toolContext,
			extensionContext,
		);
		expect(listResult.content[0]?.text).toContain("1 open map(s)");
		expect(listResult.content[0]?.text).toContain(`${map.title} (${map.id})`);
		expect(toolContext.trackerSession.getActiveMap()).toBe(map.id);
		expect(persistState).toHaveBeenCalledWith(map.id);
		expect(updateStatus).toHaveBeenCalledWith(extensionContext, {
			mode: "local",
			activeMap: map.id,
		});

		const getResult = await handleAction(
			"get_map",
			{},
			toolContext,
			extensionContext,
		);
		expect(getResult.content[0]?.text).toContain("## GENIE 2780");
		expect(getResult.content[0]?.text).not.toContain(
			"Error: no map_id provided and no active map.",
		);
	});
});

describe("Wayfinder presentation and claims", () => {
	it("puts ticket names first and claims for the dev driving the map", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
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
		const { extensionContext, toolContext } = makeContext(dir.path);
		vi.stubEnv("PI_ISSUE_TOOLS_CLAIMANT", "Jonathan Haines");

		const frontier = await handleAction(
			"list_frontier",
			{ map_id: map.id },
			toolContext,
			extensionContext,
		);
		const frontierText = frontier.content[0]?.text ?? "";
		expect(frontierText).toContain(`Choose the naming rule (${ticket.id})`);
		expect(frontierText.indexOf(ticket.title)).toBeLessThan(
			frontierText.indexOf(ticket.id),
		);

		try {
			await handleAction(
				"claim",
				{ ticket_id: ticket.id },
				toolContext,
				extensionContext,
			);
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
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
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
		const { extensionContext, toolContext } = makeContext(dir.path);
		toolContext.trackerSession.setActiveMap("wrong-map", extensionContext);

		const complete = await handleAction(
			"resolve",
			{
				map_id: map.id,
				ticket_id: ticket.id,
				resolution: "Take path A.",
				gist: "Take path A.",
			},
			toolContext,
			extensionContext,
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
			extensionContext,
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
		const closedPath = join(localTrackerRoot(dir.path), map.id, closed.url);
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
			extensionContext,
		);
		expect(terminal.content[0]?.text).toContain("Outcome: terminal");
		expect(terminal.content[0]?.text).toContain("Human inspection is required");
	});
});

describe("Generic issue actions", () => {
	it("creates and reads a generic issue end-to-end on the local tracker", async () => {
		using dir = tempDir();
		const { extensionContext, toolContext } = makeContext(dir.path);

		const createResult = await handleAction(
			"issue_create",
			{
				title: "Add a generic issue surface",
				body: "Spec is at /path/to/spec.md.",
				labels: ["needs-triage", "bug"],
			},
			toolContext,
			extensionContext,
		);
		expect(createResult.content[0]?.text).toContain(
			"Issue created: Add a generic issue surface",
		);
		const idMatch = /ID: (\S+)/.exec(createResult.content[0]?.text ?? "");
		const issueId = idMatch?.[1];
		expect(issueId).toBeDefined();
		const details = createResult.details as {
			id: string;
			url: string;
			title: string;
		};
		expect(details.id).toBe(issueId);
		expect(details.url).toBe(`${issueId}.md`);

		const readResult = await handleAction(
			"issue_read",
			{ id: issueId ?? "" },
			toolContext,
			extensionContext,
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
			extensionContext,
		);
		expect(readByUrl.content[0]?.text).toContain(
			"## Add a generic issue surface",
		);
	});

	it("reads a generic issue by its URL", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Untracked question",
			body: "Body.",
		});

		const { extensionContext, toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_read",
			{ id: issue.url },
			toolContext,
			extensionContext,
		);
		expect(result.content[0]?.text).toContain("## Untracked question");
	});

	it("applies and removes labels via issue_label and returns the resulting set", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});

		const { extensionContext, toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_label",
			{
				id: issue.id,
				add: ["bug"],
				remove: ["needs-triage"],
			},
			toolContext,
			extensionContext,
		);
		expect(result.content[0]?.text).toContain(
			`Issue ${issue.id}: labels now bug`,
		);
		const details = result.details as { labels: string[] };
		expect(details.labels).toEqual(["bug"]);
	});

	it("posts a comment via issue_comment and reports the post", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});

		const { extensionContext, toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_comment",
			{ id: issue.id, body: "First agent note" },
			toolContext,
			extensionContext,
		);
		expect(result.content[0]?.text).toContain("Comment posted on");
		const details = result.details as { comment: { content: string } };
		expect(details.comment.content).toBe("First agent note");
	});

	it("closes an issue via issue_close with an optional closing note", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const issues = modules.issues;
		const issue = await issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["wontfix"],
		});

		const { extensionContext, toolContext } = makeContext(dir.path);
		const result = await handleAction(
			"issue_close",
			{ id: issue.id, comment: "Won't fix in this milestone." },
			toolContext,
			extensionContext,
		);
		expect(result.content[0]?.text).toContain(
			`Issue ${issue.id}: closed (closing note posted)`,
		);
		const details = result.details as { status: "open" | "closed" };
		expect(details.status).toBe("closed");

		const after = await issues.readIssue(issue.id);
		expect(after.status).toBe("closed");
		expect(after.comments.map((c) => c.content)).toEqual([
			"Won't fix in this milestone.",
		]);
	});

	it("lists issues via issue_list with state/labels/unlabeled filters", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
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

		const { extensionContext, toolContext } = makeContext(dir.path);

		const openTriage = await handleAction(
			"issue_list",
			{ labels: ["needs-triage"] },
			toolContext,
			extensionContext,
		);
		expect(openTriage.content[0]?.text).toContain("1 issue(s)");
		expect(openTriage.content[0]?.text).toContain("Triage me");

		const unlabeledResult = await handleAction(
			"issue_list",
			{ unlabeled: true },
			toolContext,
			extensionContext,
		);
		expect(unlabeledResult.content[0]?.text).toContain(unlabeled.id);
		expect(unlabeledResult.content[0]?.text).not.toContain("Triage me");

		const closedResult = await handleAction(
			"issue_list",
			{ state: "closed" },
			toolContext,
			extensionContext,
		);
		expect(closedResult.content[0]?.text).toContain("Closed triage");
		expect(closedResult.content[0]?.text).toContain("[closed]");
	});
});
