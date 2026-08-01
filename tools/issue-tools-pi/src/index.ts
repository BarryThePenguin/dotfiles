/**
 * Wayfinder Pi Extension — Maps large efforts as decision tickets on the selected tracker.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	ChartParams,
	ClaimParams,
	CreateTicketParams,
	GetMapParams,
	GetTicketParams,
	IssueCreateParams,
	IssueReadParams,
	ListFrontierParams,
	ListMapsParams,
	ResolveParams,
	SetBlockingParams,
	UpdateMapParams,
} from "issue-tools-core";
import { handleAction, type ToolContext } from "./actions.ts";
import { renderCall, renderResult } from "./render.ts";
import {
	detectTrackerSelection,
	localTrackerRoot,
	type TrackerMode,
} from "./tracker.ts";

const STATUS_KEY = "issue-tools";

export default function wayfinderExtension(pi: ExtensionAPI) {
	let activeMap: string | null = null;
	let trackerMode: TrackerMode | null = null;

	const persistState = () => {
		pi.appendEntry("issue-tools-state", { activeMap });
	};

	const resolveTrackerMode = async (
		ctx: ExtensionContext,
	): Promise<TrackerMode> => {
		if (trackerMode) {
			return trackerMode;
		}

		const selection = detectTrackerSelection(ctx.cwd);
		if (selection) {
			trackerMode = selection;
			return trackerMode;
		}

		if (!ctx.hasUI) {
			trackerMode = "local";
			return trackerMode;
		}

		const choice = await ctx.ui.select("Wayfinder tracker", [
			"Local Markdown (.scratch)",
			"Todoist (.doistrc)",
		]);
		trackerMode = choice === "Todoist (.doistrc)" ? "todoist" : "local";
		ctx.ui.notify(`Wayfinder tracker: ${trackerMode}`, "info");
		updateStatus(ctx);
		return trackerMode;
	};

	const updateStatus = (ctx: ExtensionContext) => {
		const mode = trackerMode ?? detectTrackerSelection(ctx.cwd);
		if (!mode) {
			ctx.ui.setStatus(
				STATUS_KEY,
				ctx.ui.theme.fg("warning", "🗺 choose tracker"),
			);
			return;
		}
		const label = activeMap ? `🗺 ${mode}:${activeMap}` : `🗺 ${mode}`;
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg(
				"accent",
				mode === "local" ? `${label} (${localTrackerRoot(ctx.cwd)})` : label,
			),
		);
	};

	const getState = (): ToolContext => ({
		get activeMap() {
			return activeMap;
		},
		set activeMap(value) {
			activeMap = value;
		},
		get trackerMode() {
			return trackerMode;
		},
		resolveTrackerMode,
		persistState,
		updateStatus,
	});

	// -- Session lifecycle ---------------------------------------------------

	pi.on("session_start", (_event, ctx) => {
		activeMap = null;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === "issue-tools-state") {
				// `maps` was dropped from the persisted shape; older sessions may
				// still carry it. We just ignore it.
				const data = entry.data as { activeMap?: string | null } | undefined;
				activeMap = data?.activeMap ?? null;
			}
		}
		updateStatus(ctx);
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
		description: "Create a generic issue on the selected tracker.",
		promptSnippet: "Create a generic issue on the selected tracker",
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
		description: "Read a generic issue from the selected tracker.",
		promptSnippet: "Read a generic issue from the selected tracker",
		parameters: IssueReadParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("issue_read", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("issue_read", args, theme),
		renderResult,
	});
}
