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
 * The two domain modules share one selected persistence adapter. The factory
 * receives narrow views of that adapter so each module sees only its own
 * persistence capability.
 */
export type TrackerStorage = {
	issues: IssueTracker;
	wayfinder: WayfinderTracker;
};

export type TrackerModules = {
	issues: IssueTracker;
	wayfinder: WayfinderTracker;
};

export class IssueModule implements IssueTracker {
	readonly #storage: IssueTracker;

	constructor(storage: IssueTracker) {
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
	readonly #storage: WayfinderTracker;

	constructor(storage: WayfinderTracker) {
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

export function createTrackerModules(storage: TrackerStorage): TrackerModules {
	return {
		issues: new IssueModule(storage.issues),
		wayfinder: new WayfinderModule(storage.wayfinder),
	};
}
