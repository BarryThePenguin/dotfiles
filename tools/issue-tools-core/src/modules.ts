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
	WayfinderBlockerDetail,
	WayfinderClaimResult,
	WayfinderMapDetail,
	WayfinderTicketDetail,
	WayfinderTracker,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";
import {
	BlockerNotOnMapError,
	type ResolveTicketInput,
	type ResolveTicketResult,
} from "./tracker.ts";
import { mergeLabels } from "./labels.ts";
import { filterIssues } from "./issue-filter.ts";
import type { MapSectionKey } from "./schema.ts";
import { partitionOpenTickets } from "./tracker-operations.ts";
import { createResolutionWorkflow } from "./resolution-workflow.ts";
import type {
	IssuePersistence,
	ResolutionPersistence,
	WayfinderPersistence,
} from "./persistence.ts";

export type TrackerModules = {
	issues: IssueTracker;
	wayfinder: WayfinderTracker;
};

/** Assemble both domain modules from one private backend implementation. */
export function createTrackerModulesFromBackend(
	backend: IssuePersistence & WayfinderPersistence & ResolutionPersistence,
): TrackerModules {
	return {
		issues: new IssueModule(backend),
		wayfinder: new WayfinderModule({
			persistence: backend,
			resolutionPersistence: backend,
		}),
	};
}

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
		return this.#storage.writeIssueLabels(id, labels, current);
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
	readonly #resolutionWorkflow: ReturnType<typeof createResolutionWorkflow>;

	constructor({
		persistence,
		resolutionPersistence,
	}: {
		persistence: WayfinderPersistence;
		resolutionPersistence: ResolutionPersistence;
	}) {
		this.#storage = persistence;
		this.#resolutionWorkflow = createResolutionWorkflow(resolutionPersistence);
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
		return this.#validateBlockersOnMap(
			input.mapId,
			input.blockerIds ?? [],
		).then(() => this.#storage.createChildTicket(input));
	}

	async getMapDetail(mapId: string): Promise<WayfinderMapDetail> {
		const [map, children] = await Promise.all([
			this.#storage.getMap(mapId),
			this.#storage.listChildTickets(mapId),
		]);
		const partition = partitionOpenTickets(children);
		const openCount =
			partition.frontier.length +
			partition.blocked.length +
			partition.claimed.length;
		return {
			map,
			...partition,
			openCount,
			closedCount: children.length - openCount,
		};
	}

	async getTicketDetail(id: string): Promise<WayfinderTicketDetail> {
		const ticket = await this.#storage.getTicket(id);
		// Blockers are always same-map siblings (enforced at the write seam), so
		// the sibling list is the complete source of blocker titles on both
		// trackers — no per-blocker reads.
		const siblings = await this.#storage.listChildTickets(ticket.mapId);
		const blockers: WayfinderBlockerDetail[] = [];
		for (const blockerId of ticket.blockerIds) {
			const sibling = siblings.find((candidate) => candidate.id === blockerId);
			if (sibling) {
				blockers.push({
					id: sibling.id,
					title: sibling.title,
					url: sibling.url,
				});
			}
		}
		return { ticket, blockers };
	}

	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		// The persistence seam owns atomic claim-or-report; the module delegates.
		return this.#storage.claimTicketIfUnclaimed(id, claimant);
	}

	unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#storage.unclaimTicket(id);
	}

	resolveTicket(input: ResolveTicketInput): Promise<ResolveTicketResult> {
		return this.#resolutionWorkflow.resolve(input);
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
		const siblings = await this.#storage.listChildTicketMetadata(mapId);
		const siblingIds = new Set(siblings.map((ticket) => ticket.id));
		const missing = blockerIds.filter(
			(blockerId) => !siblingIds.has(blockerId),
		);
		if (missing.length > 0) {
			throw new BlockerNotOnMapError(mapId, missing);
		}
	}

	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		const ticket = await this.#storage.getTicketMetadata(id);
		await this.#validateBlockersOnMap(ticket.mapId, blockerIds);
		return this.#storage.setBlockingDependencies(id, blockerIds);
	}

	async updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return this.#storage.writeMapSection(mapId, section, content);
	}
}
