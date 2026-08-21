import { mkdtempDisposableSync, type DisposableTempDir } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalTrackerModules, localTrackerRoot } from "issue-tools-core";
import { handleAction } from "./actions.ts";
import { createOpenCodeSession } from "./tracker.ts";

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "issue-tools-opencode-"));
}

let cacheDir: DisposableTempDir;

beforeEach(() => {
	cacheDir = mkdtempDisposableSync(join(tmpdir(), "issue-tools-cache-"));
	process.env["XDG_CACHE_HOME"] = cacheDir.path;
});

afterEach(() => {
	cacheDir[Symbol.dispose]();
	delete process.env["XDG_CACHE_HOME"];
});

describe("Wayfinder actions", () => {
	it("makes the only listed map active so follow-up map tools can omit map_id", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const tracker = modules.wayfinder;
		const map = await tracker.createMap({
			title: "GENIE 2780",
			destination: "A clear handoff exists.",
		});
		const ctx = { session: createOpenCodeSession(dir.path) };

		const listResult = await handleAction("list_maps", {}, ctx);
		expect(listResult.output).toContain("1 open map(s)");
		expect(listResult.output).toContain(`[${map.title}](${map.url})`);
		expect(ctx.session.getActiveMap()).toBe(map.id);

		const getResult = await handleAction("get_map", {}, ctx);
		expect(getResult.output).toContain("## GENIE 2780");
		expect(getResult.output).not.toContain(
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
		const ctx = { session: createOpenCodeSession(dir.path) };
		vi.stubEnv("OPENCODE_ISSUE_TOOLS_CLAIMANT", "Jonathan Haines");

		const frontier = await handleAction(
			"list_frontier",
			{ map_id: map.id },
			ctx,
		);
		expect(frontier.output).toContain(`Choose the naming rule (${ticket.id})`);
		expect(frontier.output.indexOf(ticket.title)).toBeLessThan(
			frontier.output.indexOf(ticket.id),
		);

		try {
			await handleAction("claim", { ticket_id: ticket.id }, ctx);
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
		const ctx = { session: createOpenCodeSession(dir.path) };
		ctx.session.setActiveMap("wrong-map");

		const complete = await handleAction(
			"resolve",
			{
				map_id: map.id,
				ticket_id: ticket.id,
				resolution: "Take path A.",
				gist: "Take path A.",
			},
			ctx,
		);
		expect(complete.output).toContain("Outcome: complete");
		expect(complete.output).toContain("map decision recorded");
		expect(complete.output).toContain(
			`Unblocked tickets: ${dependent.title} (${dependent.id})`,
		);

		const ticketDetails = await handleAction(
			"get_ticket",
			{ ticket_id: ticket.id },
			ctx,
		);
		expect(ticketDetails.output).toContain("Comments (1)");
		expect(ticketDetails.output).toContain("Take path A.");
		expect(ticketDetails.output).not.toContain("Answer");

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
			ctx,
		);
		expect(terminal.output).toContain("Outcome: terminal");
		expect(terminal.output).toContain("Human inspection is required");
	});
});

describe("Generic issue actions", () => {
	it("creates and reads a generic issue end-to-end on the local tracker", async () => {
		using dir = tempDir();
		const ctx = { session: createOpenCodeSession(dir.path) };

		const createResult = await handleAction(
			"issue_create",
			{
				title: "Add a generic issue surface",
				body: "Spec is at /path/to/spec.md.",
				labels: ["needs-triage", "bug"],
			},
			ctx,
		);
		expect(createResult.output).toContain(
			"Issue created: Add a generic issue surface",
		);
		const idMatch = /ID: (\S+)/.exec(createResult.output);
		const issueId = idMatch?.[1];
		expect(issueId).toBeDefined();
		expect(createResult.metadata["id"]).toBe(issueId);

		const readResult = await handleAction(
			"issue_read",
			{ id: issueId ?? "" },
			ctx,
		);
		expect(readResult.output).toContain("## Add a generic issue surface");
		expect(readResult.output).toContain("Status: open");
		expect(readResult.output).toContain("Labels: needs-triage, bug");
		expect(readResult.output).toContain("Spec is at /path/to/spec.md.");

		const readByUrl = await handleAction(
			"issue_read",
			{ id: `${issueId}.md` },
			ctx,
		);
		expect(readByUrl.output).toContain("## Add a generic issue surface");
	});

	it("applies and removes labels via issue_label and returns the resulting set", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const issue = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const ctx = { session: createOpenCodeSession(dir.path) };

		const result = await handleAction(
			"issue_label",
			{ id: issue.id, add: ["bug"], remove: ["needs-triage"] },
			ctx,
		);
		expect(result.output).toContain(`Issue ${issue.id}: labels now bug`);
		expect(result.metadata["labels"]).toEqual(["bug"]);
	});

	it("posts a comment via issue_comment and reports the post", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const issue = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});
		const ctx = { session: createOpenCodeSession(dir.path) };

		const result = await handleAction(
			"issue_comment",
			{ id: issue.id, body: "First agent note" },
			ctx,
		);
		expect(result.output).toContain("Comment posted on");
		expect(result.metadata["comment"]).toEqual({ content: "First agent note" });
	});

	it("closes an issue via issue_close with an optional closing note", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const issue = await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
		});
		const ctx = { session: createOpenCodeSession(dir.path) };

		const result = await handleAction(
			"issue_close",
			{ id: issue.id, comment: "Won't fix in this milestone." },
			ctx,
		);
		expect(result.output).toContain(
			`Issue ${issue.id}: closed (closing note posted)`,
		);
		expect(result.metadata["status"]).toBe("closed");

		const after = await modules.issues.readIssue(issue.id);
		expect(after.status).toBe("closed");
		expect(after.comments.map((c) => c.content)).toEqual([
			"Won't fix in this milestone.",
		]);
	});

	it("lists issues via issue_list with state/labels/unlabeled filters", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const unlabeled = await modules.issues.createIssue({
			title: "Unlabeled",
			body: "Body.",
		});
		await modules.issues.createIssue({
			title: "Triage me",
			body: "Body.",
			labels: ["needs-triage"],
		});
		const closed = await modules.issues.createIssue({
			title: "Closed triage",
			body: "Body.",
			labels: ["needs-triage"],
		});
		await modules.issues.closeIssue(closed.id);
		const ctx = { session: createOpenCodeSession(dir.path) };

		const openTriage = await handleAction(
			"issue_list",
			{ labels: ["needs-triage"] },
			ctx,
		);
		expect(openTriage.output).toContain("1 issue(s)");
		expect(openTriage.output).toContain("Triage me");

		const unlabeledResult = await handleAction(
			"issue_list",
			{ unlabeled: true },
			ctx,
		);
		expect(unlabeledResult.output).toContain(unlabeled.id);
		expect(unlabeledResult.output).not.toContain("Triage me");

		const closedResult = await handleAction(
			"issue_list",
			{ state: "closed" },
			ctx,
		);
		expect(closedResult.output).toContain("Closed triage");
		expect(closedResult.output).toContain("[closed]");
	});
});
