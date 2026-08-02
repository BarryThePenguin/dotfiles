import type { MapSectionKey } from "./map-body.ts";
import type { IssueTracker } from "./issue.ts";
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

export type WayfinderTrackerMap = ParsedMapBody & {
	id: string;
	title: string;
	url: string;
};

export type WayfinderTrackerTicket = WayfinderTicket & {
	url: string;
	status: WayfinderTicketStatus;
	comments: string[];
	answer?: string;
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

export interface WayfinderTracker extends IssueTracker {
	createMap(input: CreateWayfinderMapInput): Promise<WayfinderTrackerMap>;
	listMaps(): Promise<WayfinderTrackerMap[]>;
	createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket>;
	getMap(id: string): Promise<WayfinderTrackerMap>;
	getTicket(id: string): Promise<WayfinderTrackerTicket>;
	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]>;
	listFrontierTickets(mapId: string): Promise<WayfinderTrackerTicket[]>;
	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult>;
	unclaimTicket(id: string): Promise<WayfinderTrackerTicket>;
	closeTicket(id: string): Promise<WayfinderTrackerTicket>;
	resolveTicket(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket>;
	postComment(id: string, body: string): Promise<void>;
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
