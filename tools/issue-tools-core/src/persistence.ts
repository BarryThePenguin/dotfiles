import type { CreateIssueInput, Issue, IssueComment } from "./issue.ts";
import type {
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	WayfinderClaimResult,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";
import type { MapSectionKey, DecisionSummary } from "./schema.ts";

/** Persistence capability needed by the Issue module. */
export interface IssuePersistence {
	createIssueRecord(input: CreateIssueInput): Promise<Issue>;
	readIssueRecord(id: string): Promise<Issue>;
	writeIssueLabels(
		id: string,
		labels: string[],
		current: Issue,
	): Promise<Issue>;
	appendIssueComment(
		id: string,
		body: string,
	): Promise<{ comment: IssueComment }>;
	closeIssueRecord(
		id: string,
		options: { comment?: string } | undefined,
	): Promise<{ status: "open" | "closed" }>;
	listIssueRecords(projectId?: string): Promise<Issue[]>;
}

/** Persistence capability needed by the Wayfinder module. */
export interface WayfinderPersistence {
	createMap(input: CreateWayfinderMapInput): Promise<WayfinderTrackerMap>;
	listMaps(): Promise<WayfinderTrackerMap[]>;
	createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket>;
	getMap(id: string): Promise<WayfinderTrackerMap>;
	getTicket(id: string): Promise<WayfinderTrackerTicket>;
	/** Read ticket metadata without loading tracker comments. */
	getTicketMetadata(id: string): Promise<WayfinderTrackerTicket>;
	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]>;
	/** List child ticket metadata without loading tracker comments. */
	listChildTicketMetadata(mapId: string): Promise<WayfinderTrackerTicket[]>;
	/** Persist already-decoded map sections in the tracker's representation. */
	writeMapDecisions(
		mapId: string,
		decisions: DecisionSummary[],
	): Promise<WayfinderTrackerMap>;
	writeMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap>;
	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult>;
	unclaimTicket(id: string): Promise<WayfinderTrackerTicket>;
	closeTicket(id: string): Promise<WayfinderTrackerTicket>;
	/** Record a Resolution and close the Decision ticket in one tracker-native operation (first-wins, retryable). */
	recordResolution(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket>;
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket>;
}

export type ResolutionTarget = {
	ticket: WayfinderTrackerTicket;
	map: WayfinderTrackerMap;
};

export type ResolutionState = {
	map: WayfinderTrackerMap;
	siblings: WayfinderTrackerTicket[];
};

/** Persistence capability used by the Wayfinder resolution workflow. */
export interface ResolutionPersistence {
	readResolutionTarget(ticketId: string): Promise<ResolutionTarget>;
	/** Atomically record the Resolution and close the Decision ticket. */
	recordResolution(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket>;
	readResolutionState(mapId: string): Promise<ResolutionState>;
	writeMapDecisions(
		mapId: string,
		decisions: DecisionSummary[],
	): Promise<WayfinderTrackerMap>;
}
