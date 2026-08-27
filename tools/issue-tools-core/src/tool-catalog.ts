/**
 * The registered tool surface: every `wayfinder_*` and `issue_*` tool that
 * both the Pi extension and the opencode plugin register.
 *
 * This is the single source of truth for the shared registration fields —
 * `name`, `action`, `title`, `description`, `promptSnippet`, and the
 * parameter schema — so the two hosts cannot drift from each other or from
 * the setup inventory. Hosts hang their own host-specific bits off these
 * entries (Pi's render hooks, opencode's progress title). The opencode-only
 * `issue_tracker_setup` tool is not catalogued here; it belongs to opencode.
 */

import type { FromSchema } from "json-schema-to-ts";
import type { ActionMap } from "./actions.ts";
import { MAP_SECTION_KEYS, TICKET_TYPES } from "./schema.ts";

// -- Shared parameter fragments (module-private) ---------------------------

function stringEnum<const Values extends readonly string[]>(
	values: Values,
	description?: string,
) {
	return {
		type: "string",
		enum: [...values],
		...(description !== undefined ? { description } : {}),
	} as const;
}

const ticketTypeSchema = stringEnum(TICKET_TYPES, "Ticket type");
const mapSectionSchema = stringEnum(MAP_SECTION_KEYS, "Map section to replace");
const mapId = {
	type: "string",
	description: "Map task ID (defaults to active map)",
} as const;
const ticketId = { type: "string", description: "Ticket task ID" } as const;
const issueIdOrUrl = {
	type: "string",
	description: "Repository Issue/spec ID or URL.",
} as const;

// -- Catalog type (public) --------------------------------------------------

export type ToolCatalogEntry = {
	/** The tool name the LLM calls. */
	name: string;
	/** The ActionMap key the host dispatches to. */
	action: keyof ActionMap;
	/** Human-facing title (Pi tool label, opencode progress title). */
	title: string;
	/** Description sent to the model via the tool schema. */
	description: string;
	/**
	 * Terse one-liner for the system prompt's "Available tools" inventory.
	 * Distinct from `description`: description is the full tool-schema spec;
	 * this is the compact system-prompt entry. On Pi, omitting it would exclude
	 * the tool from the inventory entirely.
	 */
	promptSnippet: string;
	/** Host-agnostic JSON Schema for the tool's parameters. */
	params: unknown;
	/** Inventory grouping for the setup docs. */
	group: "wayfinder" | "issue";
};

// -- Catalog entries (public) -----------------------------------------------

export const wayfinderChart = {
	name: "wayfinder_chart",
	action: "chart",
	title: "Wayfinder: Chart",
	description:
		"Create a new wayfinder map after /grilling and /domain-modeling have confirmed the destination.",
	promptSnippet:
		"Chart a new wayfinder map (run /grilling and /domain-modeling first to confirm the destination)",
	params: {
		type: "object",
		required: ["title", "destination"],
		properties: {
			title: {
				type: "string",
				description: "Map title (without 'Wayfinder:' prefix)",
			},
			destination: {
				type: "string",
				description:
					"User-confirmed destination after /grilling and /domain-modeling pre-map discovery (1-2 lines)",
			},
			notes: {
				type: "string",
				description:
					"Domain language, context, skills, and preferences surfaced during pre-map discovery",
			},
		},
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderGetMap = {
	name: "wayfinder_get_map",
	action: "get_map",
	title: "Wayfinder: Get Map",
	description: "Read the low-resolution wayfinder map.",
	promptSnippet: "Read the active wayfinder map (low-resolution overview)",
	params: {
		type: "object",
		properties: { map_id: mapId },
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderListMaps = {
	name: "wayfinder_list_maps",
	action: "list_maps",
	title: "Wayfinder: List Maps",
	description: "List all open wayfinder maps with clickable links.",
	promptSnippet: "List all open wayfinder maps",
	params: {
		type: "object",
		properties: {},
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderCreateTicket = {
	name: "wayfinder_create_ticket",
	action: "create_ticket",
	title: "Wayfinder: Create Ticket",
	description: "Create a decision ticket on a wayfinder map.",
	promptSnippet: "Create a decision ticket on a wayfinder map",
	params: {
		type: "object",
		required: ["title", "question", "type"],
		properties: {
			map_id: mapId,
			title: {
				type: "string",
				description:
					"Name for the ticket. Refer to tickets by name in narration and decisions — names read at a glance, bare ids do not.",
			},
			question: {
				type: "string",
				description: "The decision or investigation this ticket resolves",
			},
			type: ticketTypeSchema,
		},
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderGetTicket = {
	name: "wayfinder_get_ticket",
	action: "get_ticket",
	title: "Wayfinder: Get Ticket",
	description: "Read a wayfinder ticket's details.",
	promptSnippet: "Read a wayfinder ticket's full details",
	params: {
		type: "object",
		required: ["ticket_id"],
		properties: { ticket_id: ticketId },
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderResolve = {
	name: "wayfinder_resolve",
	action: "resolve",
	title: "Wayfinder: Resolve",
	description:
		"Resolve a ticket: record resolution, close it, append to map's Decisions.",
	promptSnippet:
		"Resolve a decision ticket: record the answer, close it, append to map decisions",
	params: {
		type: "object",
		required: ["map_id", "ticket_id", "resolution", "gist"],
		properties: {
			map_id: {
				type: "string",
				description: "The map that owns the Decision ticket",
			},
			ticket_id: ticketId,
			resolution: {
				type: "string",
				description: "The answer or decision (posted as comment)",
			},
			gist: {
				type: "string",
				description: "One-line summary for the map's Decisions so far",
			},
		},
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderUpdateMap = {
	name: "wayfinder_update_map",
	action: "update_map",
	title: "Wayfinder: Update Map",
	description:
		"Replace content of a map section (destination, notes, decisions, fog, out of scope).",
	promptSnippet:
		"Replace a wayfinder map section (destination, notes, fog, decisions, out-of-scope)",
	params: {
		type: "object",
		required: ["section", "content"],
		properties: {
			section: mapSectionSchema,
			content: { type: "string", description: "New content for the section" },
			map_id: mapId,
		},
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderSetBlocking = {
	name: "wayfinder_set_blocking",
	action: "set_blocking",
	title: "Wayfinder: Set Blocking",
	description: "Wire blocking edges between tickets.",
	promptSnippet: "Wire blocking dependencies between decision tickets",
	params: {
		type: "object",
		required: ["ticket_id", "blocked_by"],
		properties: {
			ticket_id: ticketId,
			blocked_by: {
				type: "array",
				items: { type: "string" },
				description: "Task IDs this is blocked by (empty to clear)",
			},
		},
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderListFrontier = {
	name: "wayfinder_list_frontier",
	action: "list_frontier",
	title: "Wayfinder: List Frontier",
	description:
		"List open, unblocked, unclaimed tickets — the edge of the known.",
	promptSnippet: "List frontier tickets — open, unblocked, and unclaimed",
	params: {
		type: "object",
		properties: { map_id: mapId },
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const wayfinderClaim = {
	name: "wayfinder_claim",
	action: "claim",
	title: "Wayfinder: Claim",
	description: "Claim or unclaim a ticket so concurrent sessions skip it.",
	promptSnippet: "Claim or unclaim a ticket to coordinate concurrent sessions",
	params: {
		type: "object",
		required: ["ticket_id"],
		properties: {
			ticket_id: ticketId,
			claim: {
				type: "boolean",
				description: "true to claim, false to unclaim (default: true)",
			},
		},
	},
	group: "wayfinder",
} as const satisfies ToolCatalogEntry;

export const issueCreate = {
	name: "issue_create",
	action: "issue_create",
	title: "Issue: Create",
	description: "Create a repository Issue/spec.",
	promptSnippet: "Create a repository Issue or spec",
	params: {
		type: "object",
		required: ["title"],
		properties: {
			title: { type: "string", description: "Issue title" },
			body: { type: "string", description: "Issue body / spec" },
			labels: {
				type: "array",
				items: { type: "string" },
				description: "Labels to apply",
			},
		},
	},
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueRead = {
	name: "issue_read",
	action: "issue_read",
	title: "Issue: Read",
	description: "Read a repository Issue/spec by its tracker ID or URL.",
	promptSnippet: "Read a repository Issue/spec by ID or URL",
	params: {
		type: "object",
		required: ["id"],
		properties: { id: issueIdOrUrl },
	},
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueLabel = {
	name: "issue_label",
	action: "issue_label",
	title: "Issue: Label",
	description: "Add or remove triage labels on a repository Issue/spec.",
	promptSnippet: "Add or remove triage labels on a repository Issue/spec",
	params: {
		type: "object",
		required: ["id"],
		properties: {
			id: issueIdOrUrl,
			add: {
				type: "array",
				items: { type: "string" },
				description: "Labels to add",
			},
			remove: {
				type: "array",
				items: { type: "string" },
				description: "Labels to remove",
			},
		},
	},
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueComment = {
	name: "issue_comment",
	action: "issue_comment",
	title: "Issue: Comment",
	description: "Post a comment on a repository Issue/spec.",
	promptSnippet: "Post a comment on a repository Issue/spec",
	params: {
		type: "object",
		required: ["id", "body"],
		properties: {
			id: issueIdOrUrl,
			body: { type: "string", description: "Comment body" },
		},
	},
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueClose = {
	name: "issue_close",
	action: "issue_close",
	title: "Issue: Close",
	description: "Close a repository Issue/spec, optionally with a closing note.",
	promptSnippet:
		"Close a repository Issue/spec, optionally with a closing note",
	params: {
		type: "object",
		required: ["id"],
		properties: {
			id: issueIdOrUrl,
			comment: { type: "string", description: "Closing note to post" },
		},
	},
	group: "issue",
} as const satisfies ToolCatalogEntry;

export const issueList = {
	name: "issue_list",
	action: "issue_list",
	title: "Issue: List",
	description: "List repository Issues/specs. Results are oldest first.",
	promptSnippet:
		"List repository Issues/specs (filter by state, labels, or unlabeled)",
	params: {
		type: "object",
		properties: {
			state: stringEnum(
				["open", "closed", "any"] as const,
				"Issue state filter",
			),
			labels: {
				type: "array",
				items: { type: "string" },
				description: "Label filter (all must match)",
			},
			unlabeled: {
				type: "boolean",
				description: "Only issues with no labels",
			},
			project: {
				type: "string",
				description: "Project ID to query (overrides repo default)",
			},
			projectName: {
				type: "string",
				description: "Project label from .doistrc (e.g. \"Doist\")",
			},
		},
	},
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

// -- Type aliases (derived from catalog entries) ---------------------------
// Used by actions.ts for typed handler params; re-exported via index.ts.

export type ChartParams = FromSchema<typeof wayfinderChart.params>;
export type GetMapParams = FromSchema<typeof wayfinderGetMap.params>;
export type ListMapsParams = FromSchema<typeof wayfinderListMaps.params>;
export type CreateTicketParams = FromSchema<
	typeof wayfinderCreateTicket.params
>;
export type GetTicketParams = FromSchema<typeof wayfinderGetTicket.params>;
export type ResolveParams = FromSchema<typeof wayfinderResolve.params>;
export type UpdateMapParams = FromSchema<typeof wayfinderUpdateMap.params>;
export type SetBlockingParams = FromSchema<typeof wayfinderSetBlocking.params>;
export type ListFrontierParams = FromSchema<
	typeof wayfinderListFrontier.params
>;
export type ClaimParams = FromSchema<typeof wayfinderClaim.params>;
export type IssueCreateParams = FromSchema<typeof issueCreate.params>;
export type IssueReadParams = FromSchema<typeof issueRead.params>;
export type IssueLabelParams = FromSchema<typeof issueLabel.params>;
export type IssueCommentParams = FromSchema<typeof issueComment.params>;
export type IssueCloseParams = FromSchema<typeof issueClose.params>;
export type IssueListParams = FromSchema<typeof issueList.params>;
