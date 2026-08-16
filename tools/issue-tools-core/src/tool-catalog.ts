/**
 * The registered tool surface: every `wayfinder_*` and `issue_*` tool that
 * both the Pi extension and the opencode plugin register.
 *
 * This is the single source of truth for the shared registration fields —
 * `name`, `action`, `title`, `description`, and the parameter schema — so the
 * two hosts cannot drift from each other or from the setup inventory. Hosts
 * hang their own bits off these entries (Pi's `promptSnippet` and render
 * hooks, opencode's progress title). The opencode-only `issue_tracker_setup`
 * tool is not catalogued here; it belongs to opencode.
 */

import type { ActionMap } from "./actions.ts";
import {
	chartParams,
	claimParams,
	createTicketParams,
	getMapParams,
	getTicketParams,
	issueCloseParams,
	issueCommentParams,
	issueCreateParams,
	issueLabelParams,
	issueListParams,
	issueReadParams,
	listFrontierParams,
	listMapsParams,
	resolveParams,
	setBlockingParams,
	updateMapParams,
} from "./tool-schemas.ts";

export type ToolCatalogEntry = {
	/** The tool name the LLM calls. */
	name: string;
	/** The ActionMap key the host dispatches to. */
	action: keyof ActionMap;
	/** Human-facing title (Pi tool label, opencode progress title). */
	title: string;
	/** Description sent to the model. */
	description: string;
	/** Host-agnostic JSON Schema for the tool's parameters. */
	params: unknown;
	/** Inventory grouping for the setup docs. */
	group: "wayfinder" | "issue";
};

export const wayfinderChart = {
	name: "wayfinder_chart",
	action: "chart",
	title: "Wayfinder: Chart",
	description:
		"Create a new wayfinder map after /grilling and /domain-modeling have confirmed the destination.",
	params: chartParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderGetMap = {
	name: "wayfinder_get_map",
	action: "get_map",
	title: "Wayfinder: Get Map",
	description: "Read the low-resolution wayfinder map.",
	params: getMapParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderListMaps = {
	name: "wayfinder_list_maps",
	action: "list_maps",
	title: "Wayfinder: List Maps",
	description: "List all open wayfinder maps.",
	params: listMapsParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderCreateTicket = {
	name: "wayfinder_create_ticket",
	action: "create_ticket",
	title: "Wayfinder: Create Ticket",
	description: "Create a decision ticket on a wayfinder map.",
	params: createTicketParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderGetTicket = {
	name: "wayfinder_get_ticket",
	action: "get_ticket",
	title: "Wayfinder: Get Ticket",
	description: "Read a wayfinder ticket's details.",
	params: getTicketParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderResolve = {
	name: "wayfinder_resolve",
	action: "resolve",
	title: "Wayfinder: Resolve",
	description:
		"Resolve a ticket: record resolution, close it, append to map's Decisions.",
	params: resolveParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderUpdateMap = {
	name: "wayfinder_update_map",
	action: "update_map",
	title: "Wayfinder: Update Map",
	description:
		"Replace content of a map section (destination, notes, decisions, fog, out of scope).",
	params: updateMapParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderSetBlocking = {
	name: "wayfinder_set_blocking",
	action: "set_blocking",
	title: "Wayfinder: Set Blocking",
	description: "Wire blocking edges between tickets.",
	params: setBlockingParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderListFrontier = {
	name: "wayfinder_list_frontier",
	action: "list_frontier",
	title: "Wayfinder: List Frontier",
	description:
		"List open, unblocked, unclaimed tickets — the edge of the known.",
	params: listFrontierParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderClaim = {
	name: "wayfinder_claim",
	action: "claim",
	title: "Wayfinder: Claim",
	description: "Claim or unclaim a ticket so concurrent sessions skip it.",
	params: claimParams,
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const issueCreate = {
	name: "issue_create",
	action: "issue_create",
	title: "Issue: Create",
	description: "Create a repository Issue/spec.",
	params: issueCreateParams,
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueRead = {
	name: "issue_read",
	action: "issue_read",
	title: "Issue: Read",
	description: "Read a repository Issue/spec by its tracker ID or URL.",
	params: issueReadParams,
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueLabel = {
	name: "issue_label",
	action: "issue_label",
	title: "Issue: Label",
	description:
		"Add or remove triage labels on a repository Issue/spec identified by ID or URL.",
	params: issueLabelParams,
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueComment = {
	name: "issue_comment",
	action: "issue_comment",
	title: "Issue: Comment",
	description:
		"Post a comment on a repository Issue/spec identified by ID or URL.",
	params: issueCommentParams,
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueClose = {
	name: "issue_close",
	action: "issue_close",
	title: "Issue: Close",
	description:
		"Close a repository Issue/spec identified by ID or URL, optionally with a closing note.",
	params: issueCloseParams,
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueList = {
	name: "issue_list",
	action: "issue_list",
	title: "Issue: List",
	description:
		"List repository Issues/specs, optionally filtered by state, labels, or unlabeled status. Results are oldest first.",
	params: issueListParams,
	group: "issue",
} as const satisfies ToolCatalogEntry;

/** Every registered tool, in registration order. */
export const toolCatalog = [
	wayfinderChart,
	wayfinderGetMap,
	wayfinderListMaps,
	wayfinderCreateTicket,
	wayfinderGetTicket,
	wayfinderResolve,
	wayfinderUpdateMap,
	wayfinderSetBlocking,
	wayfinderListFrontier,
	wayfinderClaim,
	issueCreate,
	issueRead,
	issueLabel,
	issueComment,
	issueClose,
	issueList,
] as const satisfies readonly ToolCatalogEntry[];
