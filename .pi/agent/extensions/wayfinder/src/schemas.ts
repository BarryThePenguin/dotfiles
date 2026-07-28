/**
 * Wayfinder tool parameter schemas.
 *
 * Source of truth: every tool's TypeBox schema lives here. The TypeScript
 * param types in actions.ts are derived from these via Static<typeof X>, so
 * the schema and the type cannot drift.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static, type TUnsafe } from "typebox";

const TICKET_VALUES = ["research", "prototype", "grilling", "task"] as const;
export const TicketType: TUnsafe<(typeof TICKET_VALUES)[number]> =
	StringEnum(TICKET_VALUES);
export type TicketType = (typeof TICKET_VALUES)[number];

const SECTION_VALUES = [
	"destination",
	"notes",
	"decisions",
	"notYetSpecified",
	"outOfScope",
] as const;
export const MapSection: TUnsafe<(typeof SECTION_VALUES)[number]> =
	StringEnum(SECTION_VALUES);
export type MapSection = (typeof SECTION_VALUES)[number];

export const MapId = Type.Optional(
	Type.String({ description: "Map task ID (defaults to active map)" }),
);
export type MapId = Static<typeof MapId>;

export const TicketId = Type.String({ description: "Ticket task ID" });
export type TicketId = Static<typeof TicketId>;

// ---------------------------------------------------------------------------
// Per-action schemas
// ---------------------------------------------------------------------------

export const ChartParams = Type.Object({
	title: Type.String({
		description: "Map title (without 'Wayfinder:' prefix)",
	}),
	destination: Type.String({
		description: "What reaching the end looks like (1-2 lines)",
	}),
	notes: Type.Optional(
		Type.String({ description: "Domain context, skills, preferences" }),
	),
});
export type ChartParams = Static<typeof ChartParams>;

export const GetMapParams = Type.Object({ map_id: MapId });
export type GetMapParams = Static<typeof GetMapParams>;

export const CreateTicketParams = Type.Object({
	map_id: MapId,
	question: Type.String({
		description: "The decision or investigation this ticket resolves",
	}),
	type: TicketType,
});
export type CreateTicketParams = {
	map_id?: string;
	question: string;
	type: TicketType;
};

export const GetTicketParams = Type.Object({ ticket_id: TicketId });
export type GetTicketParams = Static<typeof GetTicketParams>;

export const ResolveParams = Type.Object({
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
	section: MapSection,
	content: Type.String({ description: "New content for the section" }),
	map_id: MapId,
});
export type UpdateMapParams = {
	section: MapSection;
	content: string;
	map_id?: string;
};

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

// list_maps takes no parameters.
