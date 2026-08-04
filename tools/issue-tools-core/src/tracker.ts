import type { MapSectionKey } from "./schema.ts";
import type { ParsedMapBody, TicketType, WayfinderTicket } from "./schema.ts";

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

/** A blocker as resolved by getTicketDetail: sibling info for a blockerId. */
export type WayfinderBlockerDetail = {
	id: string;
	title: string;
	url: string;
};

/**
 * The map read-model: the Wayfinder map plus its Frontier partition and the
 * open/closed counts both map tools render. One call replaces the caller
 * composing getMap + listChildTickets + partition themselves.
 */
export type WayfinderMapDetail = {
	map: WayfinderTrackerMap;
	frontier: WayfinderTrackerTicket[];
	blocked: BlockedFrontierTicket[];
	claimed: WayfinderTrackerTicket[];
	openCount: number;
	closedCount: number;
};

/** The ticket read-model: the Decision ticket plus its resolved blockers. */
export type WayfinderTicketDetail = {
	ticket: WayfinderTrackerTicket;
	blockers: WayfinderBlockerDetail[];
};

export interface WayfinderTracker {
	createMap(input: CreateWayfinderMapInput): Promise<WayfinderTrackerMap>;
	listMaps(): Promise<WayfinderTrackerMap[]>;
	createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket>;
	getMapDetail(mapId: string): Promise<WayfinderMapDetail>;
	getTicketDetail(id: string): Promise<WayfinderTicketDetail>;
	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult>;
	unclaimTicket(id: string): Promise<WayfinderTrackerTicket>;
	resolveTicket(input: ResolveTicketInput): Promise<ResolveTicketResult>;
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket>;
	updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap>;
}
