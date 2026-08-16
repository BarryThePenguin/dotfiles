/**
 * Domain types and constants for the Issue and Wayfinder domain.
 *
 * This is the domain vocabulary home: everything here is tracker-neutral and
 * tool-neutral. The tool parameter schemas (JSON Schema encodings and the
 * registered tool names) live in `./tool-schemas.ts`, which imports the
 * constants from here — the dependency direction is tool → domain, never the
 * reverse.
 */

export const TICKET_TYPES = [
	"research",
	"prototype",
	"grilling",
	"task",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const MAP_SECTION_KEYS = [
	"destination",
	"notes",
	"decisions",
	"notYetSpecified",
	"outOfScope",
] as const;
export type MapSection = (typeof MAP_SECTION_KEYS)[number];

/** The map section a write targets; the Wayfinder module's section key. */
export type MapSectionKey = MapSection;

export type DecisionSummary = {
	title: string;
	url: string;
	gist: string;
};

export type OutOfScopeEntry = {
	text: string;
	reason: string;
	url?: string;
};

export type ParsedMapBody = {
	destination: string;
	notes: string;
	decisionsSoFar: DecisionSummary[];
	notYetSpecified: string[];
	outOfScope: OutOfScopeEntry[];
};

export type RenderMapBodyInput = ParsedMapBody;

export type BlockerLink = {
	text: string;
	url: string;
};

export type ParsedTicketBody = {
	question: string;
	blockers: BlockerLink[];
	claimedBy?: string;
};

export type WayfinderTicket = {
	id: string;
	mapId: string;
	title: string;
	type: TicketType;
	question: string;
	blockerIds: string[];
	claimedBy?: string;
};
