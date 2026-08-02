import { Type, type Static, type TSchema, type TUnsafe } from "typebox";

function stringEnum<const Values extends readonly string[]>(
	values: Values,
): TUnsafe<Values[number]> {
	return Type.Unsafe<Values[number]>({ type: "string", enum: [...values] });
}

export const TICKET_TYPES = [
	"research",
	"prototype",
	"grilling",
	"task",
] as const;
export const TicketTypeSchema = stringEnum(TICKET_TYPES);
export type TicketType = Static<typeof TicketTypeSchema>;

export const MAP_SECTION_KEYS = [
	"destination",
	"notes",
	"decisions",
	"notYetSpecified",
	"outOfScope",
] as const;
export const MapSectionSchema = stringEnum(MAP_SECTION_KEYS);
export type MapSection = Static<typeof MapSectionSchema>;

export const DecisionSummarySchema = Type.Object({
	title: Type.String(),
	url: Type.String(),
	gist: Type.String(),
});
export type DecisionSummary = Static<typeof DecisionSummarySchema>;

export const OutOfScopeEntrySchema = Type.Object({
	text: Type.String(),
	reason: Type.String(),
	url: Type.Optional(Type.String()),
});
export type OutOfScopeEntry = Static<typeof OutOfScopeEntrySchema>;

export const ParsedMapBodySchema = Type.Object({
	destination: Type.String(),
	notes: Type.String(),
	decisionsSoFar: Type.Array(DecisionSummarySchema),
	notYetSpecified: Type.Array(Type.String()),
	outOfScope: Type.Array(OutOfScopeEntrySchema),
});
export type ParsedMapBody = Static<typeof ParsedMapBodySchema>;

export const RenderMapBodyInputSchema = ParsedMapBodySchema;
export type RenderMapBodyInput = ParsedMapBody;

export const ParsedTicketBodySchema = Type.Object({
	question: Type.String(),
	blockerIds: Type.Array(Type.String()),
	claimedBy: Type.Optional(Type.String()),
});
export type ParsedTicketBody = Static<typeof ParsedTicketBodySchema>;

export const RenderTicketBodyInputSchema = ParsedTicketBodySchema;
export type RenderTicketBodyInput = ParsedTicketBody;

export const WayfinderMapSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	destination: Type.String(),
	notes: Type.String(),
	decisionsSoFar: Type.Array(DecisionSummarySchema),
	notYetSpecified: Type.Array(Type.String()),
	outOfScope: Type.Array(OutOfScopeEntrySchema),
});
export type WayfinderMap = Static<typeof WayfinderMapSchema>;

export const WayfinderTicketSchema = Type.Object({
	id: Type.String(),
	mapId: Type.String(),
	title: Type.String(),
	type: TicketTypeSchema,
	question: Type.String(),
	blockerIds: Type.Array(Type.String()),
	claimedBy: Type.Optional(Type.String()),
});
export type WayfinderTicket = Static<typeof WayfinderTicketSchema>;

export const LocalMapOutputSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	url: Type.String(),
	destination: Type.String(),
	notes: Type.String(),
	decisionsSoFar: Type.Array(DecisionSummarySchema),
	notYetSpecified: Type.Array(Type.String()),
	outOfScope: Type.Array(OutOfScopeEntrySchema),
});
export type LocalMapOutput = Static<typeof LocalMapOutputSchema>;

export const LocalTicketOutputSchema = Type.Object({
	id: Type.String(),
	mapId: Type.String(),
	title: Type.String(),
	type: TicketTypeSchema,
	question: Type.String(),
	blockerIds: Type.Array(Type.String()),
	claimedBy: Type.Optional(Type.String()),
	url: Type.String(),
	status: stringEnum(["open", "closed"] as const),
	comments: Type.Array(Type.String()),
	answer: Type.Optional(Type.String()),
});
export type LocalTicketOutput = Static<typeof LocalTicketOutputSchema>;

export const WayfinderToolNames = [
	"wayfinder_get_map",
	"wayfinder_create_map",
	"wayfinder_create_ticket",
	"wayfinder_query_frontier",
	"wayfinder_claim_ticket",
	"wayfinder_get_ticket",
	"wayfinder_post_resolution",
	"wayfinder_close_ticket",
	"wayfinder_update_map",
	"wayfinder_wire_blocking",
	"wayfinder_list_children",
] as const;
export const WayfinderToolNameSchema = stringEnum(WayfinderToolNames);
export type WayfinderToolName = Static<typeof WayfinderToolNameSchema>;

export const CreateMapInputSchema = Type.Object({
	title: Type.String(),
	destination: Type.String(),
	notes: Type.Optional(Type.String()),
	notYetSpecified: Type.Optional(Type.Array(Type.String())),
});
export type CreateMapInput = Static<typeof CreateMapInputSchema>;

export const CreateTicketInputSchema = Type.Object({
	mapId: Type.String(),
	title: Type.String(),
	type: TicketTypeSchema,
	question: Type.String(),
	blockerIds: Type.Optional(Type.Array(Type.String())),
});
export type CreateTicketInput = Static<typeof CreateTicketInputSchema>;

export const MapIdInputSchema = Type.Object({ mapId: Type.String() });
export type MapIdInput = Static<typeof MapIdInputSchema>;

export const TicketIdInputSchema = Type.Object({ ticketId: Type.String() });
export type TicketIdInput = Static<typeof TicketIdInputSchema>;

export const ClaimTicketInputSchema = Type.Object({
	ticketId: Type.String(),
	claimant: Type.String(),
});
export type ClaimTicketInput = Static<typeof ClaimTicketInputSchema>;

export const ClaimTicketOutputSchema = Type.Object({
	claimed: Type.Boolean(),
	ticket: LocalTicketOutputSchema,
});
export type ClaimTicketOutput = Static<typeof ClaimTicketOutputSchema>;

export const PostResolutionInputSchema = Type.Object({
	ticketId: Type.String(),
	body: Type.String(),
});
export type PostResolutionInput = Static<typeof PostResolutionInputSchema>;

export const OkOutputSchema = Type.Object({ ok: Type.Literal(true) });
export type OkOutput = Static<typeof OkOutputSchema>;

export const UpdateMapInputSchema = Type.Object({
	mapId: Type.String(),
	decision: DecisionSummarySchema,
});
export type UpdateMapInput = Static<typeof UpdateMapInputSchema>;

export const WireBlockingInputSchema = Type.Object({
	ticketId: Type.String(),
	blockerId: Type.String(),
});
export type WireBlockingInput = Static<typeof WireBlockingInputSchema>;

export const TicketListOutputSchema = Type.Array(LocalTicketOutputSchema);
export type TicketListOutput = Static<typeof TicketListOutputSchema>;

// Pi extension parameter schemas. These intentionally use snake_case where the
// public Pi tools do, while the lower-level core tools above use camelCase.
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

export const IssueCommentSchema = Type.Object({
	content: Type.String(),
	postedAt: Type.Optional(Type.String()),
});

export const IssueOutputSchema = Type.Object({
	id: Type.String(),
	url: Type.String(),
	title: Type.String(),
	body: Type.String(),
	labels: Type.Array(Type.String()),
	status: stringEnum(["open", "closed"] as const),
	comments: Type.Array(IssueCommentSchema),
	createdAt: Type.Optional(Type.String()),
	updatedAt: Type.Optional(Type.String()),
});

export const IssueIdOrUrl = Type.String({
	description: "Issue id or URL on the selected tracker",
});
export type IssueIdOrUrl = Static<typeof IssueIdOrUrl>;

export const IssueCreateParams = Type.Object({
	title: Type.String(),
	body: Type.Optional(Type.String()),
	labels: Type.Optional(Type.Array(Type.String())),
});
export type IssueCreateParams = Static<typeof IssueCreateParams>;

export const IssueCreateOutputSchema = Type.Object({
	id: Type.String(),
	url: Type.String(),
});
export type IssueCreateOutput = Static<typeof IssueCreateOutputSchema>;

export const IssueReadParams = Type.Object({ id: IssueIdOrUrl });
export type IssueReadParams = Static<typeof IssueReadParams>;

export const IssueLabelParams = Type.Object({
	id: IssueIdOrUrl,
	add: Type.Optional(Type.Array(Type.String())),
	remove: Type.Optional(Type.Array(Type.String())),
});
export type IssueLabelParams = Static<typeof IssueLabelParams>;

export const IssueLabelOutputSchema = Type.Object({
	labels: Type.Array(Type.String()),
});
export type IssueLabelOutput = Static<typeof IssueLabelOutputSchema>;

export const IssueCommentParams = Type.Object({
	id: IssueIdOrUrl,
	body: Type.String(),
});
export type IssueCommentParams = Static<typeof IssueCommentParams>;

export const IssueCommentOutputSchema = Type.Object({
	comment: IssueCommentSchema,
});
export type IssueCommentOutput = Static<typeof IssueCommentOutputSchema>;

export const IssueCloseParams = Type.Object({
	id: IssueIdOrUrl,
	comment: Type.Optional(Type.String()),
});
export type IssueCloseParams = Static<typeof IssueCloseParams>;

export const IssueCloseOutputSchema = Type.Object({
	status: stringEnum(["open", "closed"] as const),
});
export type IssueCloseOutput = Static<typeof IssueCloseOutputSchema>;

export const IssueListParams = Type.Object({
	state: Type.Optional(stringEnum(["open", "closed", "any"] as const)),
	labels: Type.Optional(Type.Array(Type.String())),
	unlabeled: Type.Optional(Type.Boolean()),
});
export type IssueListParams = Static<typeof IssueListParams>;

export const IssueListOutputSchema = Type.Array(IssueOutputSchema);
export type IssueListOutput = Static<typeof IssueListOutputSchema>;

export const GenericIssueToolNames = [
	"issue_create",
	"issue_read",
	"issue_label",
	"issue_comment",
	"issue_close",
	"issue_list",
] as const;
export const GenericIssueToolNameSchema = stringEnum(GenericIssueToolNames);
export type GenericIssueToolName = Static<typeof GenericIssueToolNameSchema>;

/**
 * The full surface of extension tools: the Wayfinder decisions tools plus
 * the generic Issue tools. The setup command and the docs derive the
 * tool inventory from this constant so they cannot drift from the
 * registered tools.
 */
export const ExtensionToolNames = [
	...WayfinderToolNames,
	...GenericIssueToolNames,
] as const;

/**
 * The actual tool names registered with the Pi extension. The Pi tool
 * surface differs from the core function names (e.g. `wayfinder_chart`
 * vs `wayfinder_create_map`); the setup command's inventory uses these
 * so the docs match the names the LLM calls.
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
export const PiIssueToolNames = [...GenericIssueToolNames] as const;
export const PiToolNames = [
	...PiWayfinderToolNames,
	...PiIssueToolNames,
] as const;

export type AnyWayfinderTypeBoxSchema = TSchema;
