import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalMarkdownTracker } from "issue-tools-core";
import { handleAction, type ToolContext } from "./actions.ts";
import { localTrackerRoot } from "./tracker.ts";

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "wayfinder-actions-"));
}

function makeContext(cwd: string) {
	let activeMap: string | null = null;
	const persistState = vi.fn();
	const updateStatus = vi.fn();
	const toolContext: ToolContext = {
		get activeMap() {
			return activeMap;
		},
		set activeMap(value) {
			activeMap = value;
		},
		trackerMode: "local",
		resolveTrackerMode: () => Promise.resolve("local"),
		persistState,
		updateStatus,
	};
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
		const tracker = new LocalMarkdownTracker(localTrackerRoot(dir.path));
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
		expect(toolContext.activeMap).toBe(map.id);
		expect(persistState).toHaveBeenCalledOnce();
		expect(updateStatus).toHaveBeenCalledWith(extensionContext);

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
		expect(readResult.content[0]?.text).toContain("Spec is at /path/to/spec.md.");

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
		const tracker = new LocalMarkdownTracker(localTrackerRoot(dir.path));
		const issue = await tracker.createIssue({
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
});
