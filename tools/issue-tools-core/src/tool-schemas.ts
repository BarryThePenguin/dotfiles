/**
 * Tool parameter schemas and registered tool names.
 *
 * This is the tool surface's parameter shapes: a host-agnostic JSON Schema for
 * every registered `wayfinder_*` and `issue_*` tool, with param types derived
 * from the schemas via `json-schema-to-ts` so the compile-time shapes cannot
 * drift from the runtime schema. The registered tool surface (names,
 * descriptions, titles, schema references) lives in `./tool-catalog.ts`; the
 * Pi extension wraps these in TypeBox (`Type.Unsafe`) and the opencode plugin
 * passes them to the opencode tool API directly — core itself depends on
 * neither schema library. The domain vocabulary (ticket types, map sections)
 * is imported from `./schema.ts` — the tool surface depends on the domain,
 * never the other way around.
 */

import type { FromSchema } from "json-schema-to-ts";
import { MAP_SECTION_KEYS, TICKET_TYPES } from "./schema.ts";

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

export const ticketTypeSchema = stringEnum(TICKET_TYPES, "Ticket type");

export const mapSectionSchema = stringEnum(
	MAP_SECTION_KEYS,
	"Map section to replace",
);

// Parameter schemas. These intentionally use snake_case where the public tools
// do; the Pi surface and opencode plugin both consume them verbatim.
export const mapId = {
	type: "string",
	description: "Map task ID (defaults to active map)",
} as const;
export type MapId = FromSchema<typeof mapId>;

export const ticketId = {
	type: "string",
	description: "Ticket task ID",
} as const;
export type TicketId = FromSchema<typeof ticketId>;

export const listMapsParams = {
	type: "object",
	properties: {},
} as const;
export type ListMapsParams = FromSchema<typeof listMapsParams>;

export const chartParams = {
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
} as const;
export type ChartParams = FromSchema<typeof chartParams>;

export const getMapParams = {
	type: "object",
	properties: { map_id: mapId },
} as const;
export type GetMapParams = FromSchema<typeof getMapParams>;

export const createTicketParams = {
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
} as const;
export type CreateTicketParams = FromSchema<typeof createTicketParams>;

export const getTicketParams = {
	type: "object",
	required: ["ticket_id"],
	properties: { ticket_id: ticketId },
} as const;
export type GetTicketParams = FromSchema<typeof getTicketParams>;

export const resolveParams = {
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
} as const;
export type ResolveParams = FromSchema<typeof resolveParams>;

export const updateMapParams = {
	type: "object",
	required: ["section", "content"],
	properties: {
		section: mapSectionSchema,
		content: { type: "string", description: "New content for the section" },
		map_id: mapId,
	},
} as const;
export type UpdateMapParams = FromSchema<typeof updateMapParams>;

export const setBlockingParams = {
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
} as const;
export type SetBlockingParams = FromSchema<typeof setBlockingParams>;

export const listFrontierParams = {
	type: "object",
	properties: { map_id: mapId },
} as const;
export type ListFrontierParams = FromSchema<typeof listFrontierParams>;

export const claimParams = {
	type: "object",
	required: ["ticket_id"],
	properties: {
		ticket_id: ticketId,
		claim: {
			type: "boolean",
			description: "true to claim, false to unclaim (default: true)",
		},
	},
} as const;
export type ClaimParams = FromSchema<typeof claimParams>;

// -- Generic issue tool surface -------------------------------------------

export const issueIdOrUrl = {
	type: "string",
	description: "Repository Issue/spec ID or URL.",
} as const;
export type IssueIdOrUrl = FromSchema<typeof issueIdOrUrl>;

export const issueCreateParams = {
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
} as const;
export type IssueCreateParams = FromSchema<typeof issueCreateParams>;

export const issueReadParams = {
	type: "object",
	required: ["id"],
	properties: { id: issueIdOrUrl },
} as const;
export type IssueReadParams = FromSchema<typeof issueReadParams>;

export const issueLabelParams = {
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
} as const;
export type IssueLabelParams = FromSchema<typeof issueLabelParams>;

export const issueCommentParams = {
	type: "object",
	required: ["id", "body"],
	properties: {
		id: issueIdOrUrl,
		body: { type: "string", description: "Comment body" },
	},
} as const;
export type IssueCommentParams = FromSchema<typeof issueCommentParams>;

export const issueCloseParams = {
	type: "object",
	required: ["id"],
	properties: {
		id: issueIdOrUrl,
		comment: { type: "string", description: "Closing note to post" },
	},
} as const;
export type IssueCloseParams = FromSchema<typeof issueCloseParams>;

export const issueListParams = {
	type: "object",
	properties: {
		state: stringEnum(["open", "closed", "any"] as const, "Issue state filter"),
		labels: {
			type: "array",
			items: { type: "string" },
			description: "Label filter (all must match)",
		},
		unlabeled: {
			type: "boolean",
			description: "Only issues with no labels",
		},
	},
} as const;
export type IssueListParams = FromSchema<typeof issueListParams>;
