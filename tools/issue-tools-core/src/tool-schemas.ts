/**
 * Pi tool parameter schemas and registered tool names.
 *
 * This is the tool surface: TypeBox validation schemas for every registered
 * `wayfinder_*` and `issue_*` tool, plus the tool-name lists the setup command
 * inventory derives from. The domain vocabulary it encodes (ticket types, map
 * sections) is imported from `./schema.ts` — the tool surface depends on the
 * domain, never the other way around.
 */

import { Type, type Static, type TUnsafe } from "typebox";
import { MAP_SECTION_KEYS, TICKET_TYPES } from "./schema.ts";

function stringEnum<const Values extends readonly string[]>(
	values: Values,
): TUnsafe<Values[number]> {
	return Type.Unsafe<Values[number]>({ type: "string", enum: [...values] });
}

export const TicketTypeSchema = stringEnum(TICKET_TYPES);

export const MapSectionSchema = stringEnum(MAP_SECTION_KEYS);

// Pi extension parameter schemas. These intentionally use snake_case where the
// public Pi tools do.
export const MapId = Type.Optional(
	Type.String({ description: "Map task ID (defaults to active map)" }),
);
export type MapId = Static<typeof MapId>;

export const TicketId = Type.String({ description: "Ticket task ID" });
export type TicketId = Static<typeof TicketId>;

export const ListMapsParams = Type.Object({});
export type ListMapsParams = Static<typeof ListMapsParams>;

export const ChartParams = Type.Object({
	title: Type.String({
		description: "Map title (without 'Wayfinder:' prefix)",
	}),
	destination: Type.String({
		description:
			"User-confirmed destination after /grilling and /domain-modeling pre-map discovery (1-2 lines)",
	}),
	notes: Type.Optional(
		Type.String({
			description:
				"Domain language, context, skills, and preferences surfaced during pre-map discovery",
		}),
	),
});
export type ChartParams = Static<typeof ChartParams>;

export const GetMapParams = Type.Object({ map_id: MapId });
export type GetMapParams = Static<typeof GetMapParams>;

export const CreateTicketParams = Type.Object({
	map_id: MapId,
	title: Type.String({
		description:
			"Name for the ticket. Refer to tickets by name in narration and decisions — names read at a glance, bare ids do not.",
	}),
	question: Type.String({
		description: "The decision or investigation this ticket resolves",
	}),
	type: TicketTypeSchema,
});
export type CreateTicketParams = Static<typeof CreateTicketParams>;

export const GetTicketParams = Type.Object({ ticket_id: TicketId });
export type GetTicketParams = Static<typeof GetTicketParams>;

export const ResolveParams = Type.Object({
	map_id: Type.String({
		description: "The map that owns the Decision ticket",
	}),
	ticket_id: TicketId,
	resolution: Type.String({
		description: "The answer or decision (posted as comment)",
	}),
	gist: Type.String({
		description: "One-line summary for the map's Decisions so far",
	}),
});
export type ResolveParams = Static<typeof ResolveParams>;

export const UpdateMapParams = Type.Object({
	section: MapSectionSchema,
	content: Type.String({ description: "New content for the section" }),
	map_id: MapId,
});
export type UpdateMapParams = Static<typeof UpdateMapParams>;

export const SetBlockingParams = Type.Object({
	ticket_id: TicketId,
	blocked_by: Type.Array(Type.String(), {
		description: "Task IDs this is blocked by (empty to clear)",
	}),
});
export type SetBlockingParams = Static<typeof SetBlockingParams>;

export const ListFrontierParams = Type.Object({ map_id: MapId });
export type ListFrontierParams = Static<typeof ListFrontierParams>;

export const ClaimParams = Type.Object({
	ticket_id: TicketId,
	claim: Type.Optional(
		Type.Boolean({
			description: "true to claim, false to unclaim (default: true)",
		}),
	),
});
export type ClaimParams = Static<typeof ClaimParams>;

// -- Generic issue tool surface -------------------------------------------

export const IssueIdOrUrl = Type.String({
	description: "Repository Issue/spec ID or URL.",
});
export type IssueIdOrUrl = Static<typeof IssueIdOrUrl>;

export const IssueCreateParams = Type.Object({
	title: Type.String(),
	body: Type.Optional(Type.String()),
	labels: Type.Optional(Type.Array(Type.String())),
});
export type IssueCreateParams = Static<typeof IssueCreateParams>;

export const IssueReadParams = Type.Object({ id: IssueIdOrUrl });
export type IssueReadParams = Static<typeof IssueReadParams>;

export const IssueLabelParams = Type.Object({
	id: IssueIdOrUrl,
	add: Type.Optional(Type.Array(Type.String())),
	remove: Type.Optional(Type.Array(Type.String())),
});
export type IssueLabelParams = Static<typeof IssueLabelParams>;

export const IssueCommentParams = Type.Object({
	id: IssueIdOrUrl,
	body: Type.String(),
});
export type IssueCommentParams = Static<typeof IssueCommentParams>;

export const IssueCloseParams = Type.Object({
	id: IssueIdOrUrl,
	comment: Type.Optional(Type.String()),
});
export type IssueCloseParams = Static<typeof IssueCloseParams>;

export const IssueListParams = Type.Object({
	state: Type.Optional(stringEnum(["open", "closed", "any"] as const)),
	labels: Type.Optional(Type.Array(Type.String())),
	unlabeled: Type.Optional(Type.Boolean()),
});
export type IssueListParams = Static<typeof IssueListParams>;

export const PiIssueToolNames = [
	"issue_create",
	"issue_read",
	"issue_label",
	"issue_comment",
	"issue_close",
	"issue_list",
] as const;

/**
 * The actual tool names registered with the Pi extension. The setup
 * command's inventory uses these so the docs match the names the LLM
 * calls.
 */
export const PiWayfinderToolNames = [
	"wayfinder_chart",
	"wayfinder_get_map",
	"wayfinder_list_maps",
	"wayfinder_create_ticket",
	"wayfinder_get_ticket",
	"wayfinder_resolve",
	"wayfinder_update_map",
	"wayfinder_set_blocking",
	"wayfinder_list_frontier",
	"wayfinder_claim",
] as const;
export const PiToolNames = [
	...PiWayfinderToolNames,
	...PiIssueToolNames,
] as const;
