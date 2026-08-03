import type { MapSectionKey } from "./map-body.ts";
import type {
	DecisionSummary,
	ParsedMapBody,
	TicketType,
	WayfinderTicket,
} from "./schema.ts";

export type WayfinderTicketStatus = "open" | "closed";

export class ClosedTicketWithoutResolutionError extends Error {
	readonly code = "closed_ticket_without_resolution" as const;

	constructor(ticketId: string) {
		super(
			`Ticket ${ticketId} is already closed without the requested Resolution.`,
		);
		this.name = "ClosedTicketWithoutResolutionError";
	}
}

export class BlockerNotOnMapError extends Error {
	readonly code = "blocker_not_on_map" as const;

	constructor(mapId: string, blockerIds: string[]) {
		super(
			`Blockers ${blockerIds.join(", ")} are not on Wayfinder map ${mapId}.`,
		);
		this.name = "BlockerNotOnMapError";
	}
}

export type WayfinderTrackerMap = ParsedMapBody & {
	id: string;
	title: string;
	url: string;
};

export type WayfinderTrackerTicket = WayfinderTicket & {
	url: string;
	status: WayfinderTicketStatus;
	comments: string[];
};

export type CreateWayfinderMapInput = {
	title: string;
	destination: string;
	notes?: string;
	notYetSpecified?: string[];
};

export type CreateWayfinderChildTicketInput = {
	mapId: string;
	title: string;
	type: TicketType;
	question: string;
	blockerIds?: string[];
};

export type WayfinderClaimResult = {
	claimed: boolean;
	ticket: WayfinderTrackerTicket;
};

export type BlockedFrontierTicket = {
	ticket: WayfinderTrackerTicket;
	blockers: string[];
};

export type FrontierInspection = {
	frontier: WayfinderTrackerTicket[];
	blocked: BlockedFrontierTicket[];
	claimed: WayfinderTrackerTicket[];
};

export type ResolveOutcome = "complete" | "partial" | "terminal";

export type ResolveTicketInput = {
	ticketId: string;
	mapId: string;
	resolution: string;
	gist: string;
};

export type ResolveTicketResult = {
	outcome: ResolveOutcome;
	resolvedTicket: WayfinderTrackerTicket;
	map?: WayfinderTrackerMap;
	mapId: string;
	unblocked: string[];
	error?: string;
	resolutionPosted: boolean;
	decisionRecorded: boolean;
};

export interface WayfinderTracker {
	createMap(input: CreateWayfinderMapInput): Promise<WayfinderTrackerMap>;
	listMaps(): Promise<WayfinderTrackerMap[]>;
	createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket>;
	getMap(id: string): Promise<WayfinderTrackerMap>;
	getTicket(id: string): Promise<WayfinderTrackerTicket>;
	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]>;
	inspectFrontier(mapId: string): Promise<FrontierInspection>;
	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult>;
	unclaimTicket(id: string): Promise<WayfinderTrackerTicket>;
	closeTicket(id: string): Promise<WayfinderTrackerTicket>;
	resolveTicket(input: ResolveTicketInput): Promise<ResolveTicketResult>;
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket>;
	addBlockingDependency(
		id: string,
		blockerId: string,
	): Promise<WayfinderTrackerTicket>;
	recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<WayfinderTrackerMap>;
	updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap>;
}
