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
	FrontierInspection,
	WayfinderClaimResult,
	WayfinderTracker,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";
import {
	BlockerNotOnMapError,
	ClosedTicketWithoutResolutionError,
	type ResolveTicketInput,
	type ResolveTicketResult,
} from "./tracker.ts";
import { mergeLabels } from "doist-core";
import { filterIssues } from "./issue-filter.ts";
import type { MapSectionKey } from "./map-body.ts";
import {
	addBlockingDependency as addBlockingDependencyOperation,
	canClaimTicket,
	partitionOpenTickets,
} from "./tracker-operations.ts";
import type { DecisionSummary } from "./schema.ts";

/**
 * Persistence capability needed by the Issue module.
 *
 * This is deliberately a separate interface from IssueTracker: adapters can
 * satisfy the capability without becoming the public domain module, and the
 * module can be tested with an in-memory implementation.
 */
export interface IssuePersistence {
	createIssueRecord(input: CreateIssueInput): Promise<Issue>;
	readIssueRecord(id: string): Promise<Issue>;
	writeIssueLabels(id: string, labels: string[]): Promise<Issue>;
	appendIssueComment(
		id: string,
		body: string,
	): Promise<{ comment: IssueComment }>;
	closeIssueRecord(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }>;
	listIssueRecords(): Promise<Issue[]>;
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
	/** Record a Resolution and close the ticket in one tracker-native operation (first-wins, retryable). */
	recordResolution(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket>;
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket>;
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
		return this.#storage.createIssueRecord({
			...input,
			labels: input.labels ?? [],
		});
	}

	readIssue(id: string): Promise<Issue> {
		return this.#storage.readIssueRecord(id);
	}

	async updateIssueLabels(
		id: string,
		input: UpdateIssueLabelsInput,
	): Promise<Issue> {
		const current = await this.#storage.readIssueRecord(id);
		const labels = mergeLabels(current.labels, input.add, input.remove);
		return this.#storage.writeIssueLabels(id, labels);
	}

	commentOnIssue(id: string, body: string): Promise<{ comment: IssueComment }> {
		return this.#storage.appendIssueComment(id, body);
	}

	closeIssue(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }> {
		return this.#storage.closeIssueRecord(id, options);
	}

	async listIssues(filter: ListIssuesFilter): Promise<Issue[]> {
		return filterIssues(await this.#storage.listIssueRecords(), filter);
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
		return this.#validateBlockersOnMap(input.mapId, input.blockerIds ?? []).then(
			() => this.#storage.createChildTicket(input),
		);
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

	async inspectFrontier(mapId: string): Promise<FrontierInspection> {
		return partitionOpenTickets(
			await this.#storage.listChildTickets(mapId),
		);
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		const ticket = await this.#storage.getTicket(id);
		if (!canClaimTicket(ticket)) {
			return { claimed: false, ticket };
		}
		return this.#storage.claimTicketIfUnclaimed(id, claimant);
	}

	unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#storage.unclaimTicket(id);
	}

	closeTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#storage.closeTicket(id);
	}

	async resolveTicket(
		input: ResolveTicketInput,
	): Promise<ResolveTicketResult> {
		const ticket = await this.#storage.getTicket(input.ticketId);
		if (!ticket.mapId) {
			throw new Error(`Ticket ${input.ticketId} has no map identity.`);
		}
		if (ticket.mapId !== input.mapId) {
			throw new Error(
				`Ticket ${input.ticketId} has map identity ${ticket.mapId}, not ${input.mapId}.`,
			);
		}

		// Validate the map before the adapter is allowed to mutate anything.
		await this.#storage.getMap(input.mapId);

		let resolvedTicket: WayfinderTrackerTicket;
		try {
			resolvedTicket = await this.#storage.recordResolution(
				input.ticketId,
				input.resolution,
			);
		} catch (error) {
			if (!(error instanceof ClosedTicketWithoutResolutionError)) {
				throw error;
			}
			return {
				outcome: "terminal",
				resolvedTicket: ticket,
				mapId: input.mapId,
				unblocked: [],
				error: error.message,
				resolutionPosted: false,
				decisionRecorded: false,
			};
		}

		const siblings = await this.#storage.listChildTickets(input.mapId);
		const partition = partitionOpenTickets(siblings);
		const unblockedIds = new Set(
			[...partition.frontier, ...partition.claimed]
				.filter((ticket) => ticket.blockerIds.includes(input.ticketId))
				.map((ticket) => ticket.id),
		);
		// Preserve sibling order in the report.
		const unblocked = siblings
			.filter((ticket) => unblockedIds.has(ticket.id))
			.map((ticket) => ticket.id);
		try {
			const map = await this.recordDecision(input.mapId, {
				title: ticket.title,
				url: ticket.url,
				gist: input.gist,
			});
			return {
				outcome: "complete",
				resolvedTicket,
				map,
				mapId: input.mapId,
				unblocked,
				resolutionPosted: true,
				decisionRecorded: true,
			};
		} catch (error) {
			return {
				outcome: "partial",
				resolvedTicket,
				mapId: input.mapId,
				unblocked,
				error: error instanceof Error ? error.message : String(error),
				resolutionPosted: true,
				decisionRecorded: false,
			};
		}
	}

	/**
	 * Blockers are Decision tickets on the same Wayfinder map. Enforce that
	 * here, at the write seam, so the frontier classification can derive all
	 * blocker statuses from a map's own sibling list.
	 */
	async #validateBlockersOnMap(
		mapId: string,
		blockerIds: string[],
	): Promise<void> {
		if (blockerIds.length === 0) {
			return;
		}
		const siblings = await this.#storage.listChildTickets(mapId);
		const siblingIds = new Set(siblings.map((ticket) => ticket.id));
		const missing = blockerIds.filter((blockerId) => !siblingIds.has(blockerId));
		if (missing.length > 0) {
			throw new BlockerNotOnMapError(mapId, missing);
		}
	}

	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		const ticket = await this.#storage.getTicket(id);
		await this.#validateBlockersOnMap(ticket.mapId, blockerIds);
		return this.#storage.setBlockingDependencies(id, blockerIds);
	}

	addBlockingDependency(
		id: string,
		blockerId: string,
	): Promise<WayfinderTrackerTicket> {
		// Route through the module's own validated setBlockingDependencies so
		// the same-map invariant cannot be bypassed by a sibling operation.
		return addBlockingDependencyOperation(this, id, blockerId);
	}

	async recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<WayfinderTrackerMap> {
		const map = await this.#storage.getMap(mapId);
		if (map.decisionsSoFar.some((existing) => existing.url === decision.url)) {
			return map;
		}
		return this.#storage.writeMapDecisions(mapId, [
			...map.decisionsSoFar,
			decision,
		]);
	}

	async updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return this.#storage.writeMapSection(mapId, section, content);
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
