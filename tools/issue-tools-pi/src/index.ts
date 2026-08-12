/**
 * Wayfinder Pi Extension — Maps large efforts as decision tickets on the selected tracker.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createContainer } from "doist-core";
import {
	ChartParams,
	ClaimParams,
	createLocalTrackerModules,
	createTodoistTrackerModules,
	createTrackerSession,
	CreateTicketParams,
	detectTrackerSelection,
	GetMapParams,
	GetTicketParams,
	IssueCloseParams,
	IssueCommentParams,
	IssueCreateParams,
	IssueLabelParams,
	IssueListParams,
	IssueReadParams,
	ListFrontierParams,
	ListMapsParams,
	localTrackerRoot,
	ResolveParams,
	SetBlockingParams,
	toolInventory,
	UpdateMapParams,
	type CreateWayfinderTrackerOptions,
	type TrackerMode,
	type TrackerModules,
} from "issue-tools-core";
import { handleAction, type ToolContext } from "./actions.ts";
import { renderCall, renderResult } from "./render.ts";

export async function createTrackerModules({
	cwd,
	mode,
}: CreateWayfinderTrackerOptions): Promise<TrackerModules> {
	if (mode === "local") {
		return createLocalTrackerModules(localTrackerRoot(cwd));
	}
	return createTodoistTrackerModules();
}

const STATUS_KEY = "issue-tools";

export default function wayfinderExtension(pi: ExtensionAPI) {
	const persistState = (activeMap: string | null) => {
		pi.appendEntry("issue-tools-state", { activeMap });
	};

	const selectTrackerMode = async (
		ctx: ExtensionContext,
	): Promise<TrackerMode> => {
		const selection = detectTrackerSelection(ctx.cwd);
		if (selection === "local" || selection === "todoist") {
			return selection;
		}

		// both markers or neither: ask the user
		if (!ctx.hasUI) {
			return "local";
		}

		const choice = await ctx.ui.select("Wayfinder tracker", [
			"Local Markdown (.scratch)",
			"Todoist (.doistrc)",
		]);
		const mode = choice === "Todoist (.doistrc)" ? "todoist" : "local";
		ctx.ui.notify(`Wayfinder tracker: ${mode}`, "info");
		return mode;
	};

	const updateStatus = (
		ctx: ExtensionContext,
		state: { mode: TrackerMode | null; activeMap: string | null },
	) => {
		const mode = state.mode ?? detectTrackerSelection(ctx.cwd);
		if (mode === "both" || mode === "neither") {
			ctx.ui.setStatus(
				STATUS_KEY,
				ctx.ui.theme.fg("warning", "🗺 choose tracker"),
			);
			return;
		}
		const label = state.activeMap
			? `🗺 ${mode}:${state.activeMap}`
			: `🗺 ${mode}`;
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg(
				"accent",
				mode === "local" ? `${label} (${localTrackerRoot(ctx.cwd)})` : label,
			),
		);
	};

	const getState = (): ToolContext => ({ trackerSession });

	// -- Session lifecycle ---------------------------------------------------

	let trackerSession = createTrackerSession({
		cwd: ".",
		selectMode: selectTrackerMode,
		buildModules: createTrackerModules,
		persistState,
		updateStatus,
	});

	pi.on("session_start", (_event, ctx) => {
		trackerSession = createTrackerSession({
			cwd: ctx.cwd,
			selectMode: selectTrackerMode,
			buildModules: createTrackerModules,
			persistState,
			updateStatus,
		});
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === "issue-tools-state") {
				// `maps` was dropped from the persisted shape; older sessions may
				// still carry it. We just ignore it.
				const data = entry.data as { activeMap?: string | null } | undefined;
				trackerSession.restore({ activeMap: data?.activeMap ?? null });
			}
		}
		trackerSession.refresh(ctx);
	});

	// -- Tools ---------------------------------------------------------------

	pi.registerTool({
		name: "wayfinder_chart",
		label: "Wayfinder: Chart",
		description:
			"Create a new wayfinder map after /grilling and /domain-modeling have confirmed the destination.",
		promptSnippet:
			"Create a wayfinder map after confirming the destination with grilling and domain modeling",
		parameters: ChartParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("chart", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("chart", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_get_map",
		label: "Wayfinder: Get Map",
		description: "Read the low-resolution wayfinder map.",
		promptSnippet:
			"Read the low-resolution wayfinder map from the selected tracker",
		parameters: GetMapParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("get_map", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("get_map", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_list_maps",
		label: "Wayfinder: List Maps",
		description: "List all open wayfinder maps.",
		promptSnippet: "List wayfinder maps from the selected tracker",
		parameters: ListMapsParams,
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			return handleAction("list_maps", {}, getState(), ctx);
		},
		renderCall: (_args, theme) => renderCall("list_maps", {}, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_create_ticket",
		label: "Wayfinder: Create Ticket",
		description: "Create a decision ticket on a wayfinder map.",
		promptSnippet: "Create a wayfinder ticket on the selected tracker",
		parameters: CreateTicketParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("create_ticket", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("create_ticket", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_get_ticket",
		label: "Wayfinder: Get Ticket",
		description: "Read a wayfinder ticket's details.",
		promptSnippet: "Read a wayfinder ticket from the selected tracker",
		parameters: GetTicketParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("get_ticket", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("get_ticket", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_resolve",
		label: "Wayfinder: Resolve",
		description:
			"Resolve a ticket: record resolution, close it, append to map's Decisions.",
		promptSnippet: "Resolve a wayfinder ticket on the selected tracker",
		parameters: ResolveParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("resolve", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("resolve", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_update_map",
		label: "Wayfinder: Update Map",
		description:
			"Replace content of a map section (destination, notes, decisions, fog, out of scope).",
		promptSnippet: "Update a wayfinder map section on the selected tracker",
		parameters: UpdateMapParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("update_map", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("update_map", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_set_blocking",
		label: "Wayfinder: Set Blocking",
		description: "Wire blocking edges between tickets.",
		promptSnippet: "Set blocking on a wayfinder ticket on the selected tracker",
		parameters: SetBlockingParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("set_blocking", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("set_blocking", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_list_frontier",
		label: "Wayfinder: List Frontier",
		description:
			"List open, unblocked, unclaimed tickets — the edge of the known.",
		promptSnippet: "List wayfinder frontier tickets from the selected tracker",
		parameters: ListFrontierParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("list_frontier", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("list_frontier", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "wayfinder_claim",
		label: "Wayfinder: Claim",
		description: "Claim or unclaim a ticket so concurrent sessions skip it.",
		promptSnippet: "Claim a wayfinder ticket on the selected tracker",
		parameters: ClaimParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("claim", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("claim", args, theme),
		renderResult,
	});

	// -- Generic issue tools ---------------------------------------------

	pi.registerTool({
		name: "issue_create",
		label: "Issue: Create",
		description: "Create a repository Issue/spec.",
		promptSnippet: "Create a repository Issue/spec",
		parameters: IssueCreateParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("issue_create", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("issue_create", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "issue_read",
		label: "Issue: Read",
		description: "Read a repository Issue/spec by its tracker ID or URL.",
		promptSnippet: "Read a repository Issue/spec by ID or URL",
		parameters: IssueReadParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("issue_read", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("issue_read", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "issue_label",
		label: "Issue: Label",
		description:
			"Add or remove triage labels on a repository Issue/spec identified by ID or URL.",
		promptSnippet: "Add or remove triage labels on a repository Issue/spec",
		parameters: IssueLabelParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("issue_label", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("issue_label", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "issue_comment",
		label: "Issue: Comment",
		description:
			"Post a comment on a repository Issue/spec identified by ID or URL.",
		promptSnippet: "Post a comment on a repository Issue/spec",
		parameters: IssueCommentParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("issue_comment", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("issue_comment", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "issue_close",
		label: "Issue: Close",
		description:
			"Close a repository Issue/spec identified by ID or URL, optionally with a closing note.",
		promptSnippet: "Close a repository Issue/spec",
		parameters: IssueCloseParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("issue_close", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("issue_close", args, theme),
		renderResult,
	});

	pi.registerTool({
		name: "issue_list",
		label: "Issue: List",
		description:
			"List repository Issues/specs, optionally filtered by state, labels, or unlabeled status. Results are oldest first.",
		promptSnippet: "List repository Issues/specs",
		parameters: IssueListParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("issue_list", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("issue_list", args, theme),
		renderResult,
	});

	// -- /setup-issue-tracker command -----------------------------------

	pi.registerCommand("setup-issue-tracker", {
		description:
			"Wire the repo's .doistrc (or detect a local tracker) so this repo's issue tracker is configured for the issue_* and wayfinder_* tools, then hand off to the setup-matt-pocock-skills skill for the docs.",
		async handler(_args, ctx) {
			await runSetupIssueTracker(ctx);
		},
	});
}

async function runSetupIssueTracker(ctx: ExtensionCommandContext) {
	const cwd = ctx.cwd;
	const selection = detectTrackerSelection(cwd);

	let resolvedMode: "local" | "todoist";
	if (selection === "local" || selection === "todoist") {
		resolvedMode = selection;
	} else {
		// both markers or neither: the repo is ambiguous
		if (!ctx.hasUI) {
			ctx.ui.notify(
				"Cannot determine tracker: no UI available to prompt.",
				"error",
			);
			return;
		}
		const choice = await ctx.ui.select("Issue tracker", [
			"Local Markdown (.scratch)",
			"Todoist (.doistrc)",
		]);
		resolvedMode = choice === "Todoist (.doistrc)" ? "todoist" : "local";
	}

	if (resolvedMode === "local") {
		ctx.ui.notify(
			"Local Markdown tracker selected. Run /setup-matt-pocock-skills to complete the docs.",
			"info",
		);
		return;
	}

	const container = createContainer();
	const projects = container.listProjects();
	if (projects.length === 0) {
		ctx.ui.notify(
			"No projects in .doistrc. Add one with `doist projects add` first, then re-run /setup-issue-tracker.",
			"error",
		);
		return;
	}

	let selectedId: string | undefined;
	if (projects.length === 1) {
		selectedId = projects[0]?.id;
	} else if (ctx.hasUI) {
		const labels = projects.map((project) => {
			const tag = project.repo === true ? " (repo)" : "";
			return `${project.id} — ${project.label}${tag}`;
		});
		const choice = await ctx.ui.select(
			"Select the repo's Todoist project (this becomes the repo Issues home)",
			labels,
		);
		if (!choice) {
			ctx.ui.notify("Setup cancelled.", "info");
			return;
		}
		selectedId = projects.find((project) => {
			const tag = project.repo === true ? " (repo)" : "";
			return `${project.id} — ${project.label}${tag}` === choice;
		})?.id;
	} else {
		selectedId = projects[0]?.id;
	}

	if (!selectedId) {
		ctx.ui.notify("Setup cancelled.", "info");
		return;
	}

	container.setRepoProject(selectedId);
	const inventory = toolInventory();
	const lines = inventory
		.map((entry) => `- \`${entry.name}\` (${entry.group})`)
		.join("\n");
	ctx.ui.notify(
		`Marked ${selectedId} as the repo project (repo: true). Tools:\n${lines}\n\nRun /setup-matt-pocock-skills to complete the docs.`,
		"info",
	);
}
