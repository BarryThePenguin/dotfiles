/**
 * Wayfinder Pi Extension — Maps large efforts as decision tickets on Todoist.
 */

import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { handleAction, type ToolContext } from "./actions.ts";
import { renderCall, renderResult } from "./render.ts";
import { STATUS_KEY } from "./helpers.ts";
import {
	ChartParams,
	ClaimParams,
	CreateTicketParams,
	GetMapParams,
	GetTicketParams,
	ListFrontierParams,
	ResolveParams,
	SetBlockingParams,
	UpdateMapParams,
} from "./schemas.ts";

const SKILL_DIR = path.join(import.meta.dirname, "../skills");

export default function wayfinderExtension(pi: ExtensionAPI) {
	let activeMap: string | null = null;

	const persistState = () => {
		pi.appendEntry("wayfinder-state", { activeMap });
	};

	const updateStatus = (ctx: ExtensionContext) => {
		ctx.ui.setStatus(
			STATUS_KEY,
			activeMap ? ctx.ui.theme.fg("accent", `🗺 ${activeMap}`) : undefined,
		);
	};

	const getState = (): ToolContext => ({
		activeMap,
		persistState,
		updateStatus,
	});

	// -- Session lifecycle ---------------------------------------------------

	pi.on("session_start", (_event, ctx) => {
		activeMap = null;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === "wayfinder-state") {
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
		description: "Create a new wayfinder map for a large effort.",
		promptSnippet: "Create a wayfinder map on Todoist",
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
		description: "Read a wayfinder map and its tickets.",
		promptSnippet: "Read a wayfinder map from Todoist",
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
		promptSnippet: "List wayfinder maps on Todoist",
		parameters: Type.Object({}),
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
		promptSnippet: "Create a wayfinder ticket on Todoist",
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
		promptSnippet: "Read a wayfinder ticket from Todoist",
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
			"Resolve a ticket: post resolution, close it, append to map's Decisions.",
		promptSnippet: "Resolve a wayfinder ticket on Todoist",
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
		promptSnippet: "Update a wayfinder map section on Todoist",
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
		promptSnippet: "Set blocking on a wayfinder ticket on Todoist",
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
		promptSnippet: "List wayfinder frontier tickets on Todoist",
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
		description:
			"Claim or unclaim a ticket (assign to yourself so others skip it).",
		promptSnippet: "Claim a wayfinder ticket on Todoist",
		parameters: ClaimParams,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			return handleAction("claim", params, getState(), ctx);
		},
		renderCall: (args, theme) => renderCall("claim", args, theme),
		renderResult,
	});

	// -- Resources -----------------------------------------------------------

	pi.on("resources_discover", (_event, _ctx) => {
		return {
			skillPaths: [path.join(SKILL_DIR, "wayfinder")],
		};
	});
}
