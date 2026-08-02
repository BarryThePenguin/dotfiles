import type {
	CreateIssueInput,
	Issue,
	IssueComment,
	IssueTracker,
	ListIssuesFilter,
	UpdateIssueLabelsInput,
} from "./issue.ts";
import type {
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	WayfinderClaimResult,
	WayfinderTracker,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";
import type { MapSectionKey } from "./map-body.ts";
import type { DecisionSummary } from "./schema.ts";

/**
 * Persistence capability needed by the Issue module.
 *
 * This is deliberately a separate interface from IssueTracker: adapters can
 * satisfy the capability without becoming the public domain module, and the
 * module can be tested with an in-memory implementation.
 */
export interface IssuePersistence {
	createIssue(input: CreateIssueInput): Promise<Issue>;
	readIssue(id: string): Promise<Issue>;
	updateIssueLabels(id: string, input: UpdateIssueLabelsInput): Promise<Issue>;
	commentOnIssue(id: string, body: string): Promise<{ comment: IssueComment }>;
	closeIssue(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }>;
	listIssues(filter: ListIssuesFilter): Promise<Issue[]>;
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

/** The one selected adapter shared by both domain modules. */
export type TrackerPersistence = IssuePersistence & WayfinderPersistence;

export type TrackerModules = {
	issues: IssueTracker;
	wayfinder: WayfinderTracker;
};

export class IssueModule implements IssueTracker {
	readonly #storage: IssuePersistence;

	constructor(storage: IssuePersistence) {
		this.#storage = storage;
	}

	createIssue(input: CreateIssueInput): Promise<Issue> {
		return this.#storage.createIssue(input);
	}

	readIssue(id: string): Promise<Issue> {
		return this.#storage.readIssue(id);
	}

	updateIssueLabels(id: string, input: UpdateIssueLabelsInput): Promise<Issue> {
		return this.#storage.updateIssueLabels(id, input);
	}

	commentOnIssue(id: string, body: string): Promise<{ comment: IssueComment }> {
		return this.#storage.commentOnIssue(id, body);
	}

	closeIssue(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }> {
		return this.#storage.closeIssue(id, options);
	}

	listIssues(filter: ListIssuesFilter): Promise<Issue[]> {
		return this.#storage.listIssues(filter);
	}
}

export class WayfinderModule implements WayfinderTracker {
	readonly #storage: WayfinderPersistence;

	constructor(storage: WayfinderPersistence) {
		this.#storage = storage;
	}

	createMap(input: CreateWayfinderMapInput): Promise<WayfinderTrackerMap> {
		return this.#storage.createMap(input);
	}

	listMaps(): Promise<WayfinderTrackerMap[]> {
		return this.#storage.listMaps();
	}

	createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket> {
		return this.#storage.createChildTicket(input);
	}

	getMap(id: string): Promise<WayfinderTrackerMap> {
		return this.#storage.getMap(id);
	}

	getTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#storage.getTicket(id);
	}

	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		return this.#storage.listChildTickets(mapId);
	}

	listFrontierTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		return this.#storage.listFrontierTickets(mapId);
	}

	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		return this.#storage.claimTicketIfUnclaimed(id, claimant);
	}

	unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#storage.unclaimTicket(id);
	}

	closeTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#storage.closeTicket(id);
	}

	resolveTicket(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket> {
		return this.#storage.resolveTicket(id, resolution);
	}

	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		return this.#storage.setBlockingDependencies(id, blockerIds);
	}

	addBlockingDependency(
		id: string,
		blockerId: string,
	): Promise<WayfinderTrackerTicket> {
		return this.#storage.addBlockingDependency(id, blockerId);
	}

	recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<WayfinderTrackerMap> {
		return this.#storage.recordDecision(mapId, decision);
	}

	updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return this.#storage.updateMapSection(mapId, section, content);
	}
}

export function createTrackerModules(
	storage: TrackerPersistence,
): TrackerModules {
	return {
		issues: new IssueModule(storage),
		wayfinder: new WayfinderModule(storage),
	};
}
