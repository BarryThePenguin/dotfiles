import { IssueModule, WayfinderModule } from "./modules.ts";
import type {
	IssuePersistence,
	TrackerModules,
	WayfinderPersistence,
} from "./modules.ts";
import { LocalMarkdownAdapter } from "./local-markdown-adapter.ts";
import type { CreateIssueInput, Issue, IssueComment } from "./issue.ts";
import type {
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	WayfinderClaimResult,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";
import type { DecisionSummary, MapSectionKey } from "./schema.ts";

/**
 * Private state for one local tracker. Both domain modules are constructed
 * from this context, so they coordinate through the same adapter and lock.
 */
type LocalTrackerContext = {
	readonly persistence: LocalMarkdownAdapter;
};

class LocalIssuePersistence implements IssuePersistence {
	readonly #adapter: LocalMarkdownAdapter;

	constructor(adapter: LocalMarkdownAdapter) {
		this.#adapter = adapter;
	}

	createIssueRecord(input: CreateIssueInput): Promise<Issue> {
		return this.#adapter.createIssueRecord(input);
	}
	readIssueRecord(id: string): Promise<Issue> {
		return this.#adapter.readIssueRecord(id);
	}
	writeIssueLabels(id: string, labels: string[]): Promise<Issue> {
		return this.#adapter.writeIssueLabels(id, labels);
	}
	appendIssueComment(
		id: string,
		body: string,
	): Promise<{ comment: IssueComment }> {
		return this.#adapter.appendIssueComment(id, body);
	}
	closeIssueRecord(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }> {
		return this.#adapter.closeIssueRecord(id, options);
	}
	listIssueRecords(): Promise<Issue[]> {
		return this.#adapter.listIssueRecords();
	}
}

class LocalWayfinderPersistence implements WayfinderPersistence {
	readonly #adapter: LocalMarkdownAdapter;

	constructor(adapter: LocalMarkdownAdapter) {
		this.#adapter = adapter;
	}

	createMap(input: CreateWayfinderMapInput): Promise<WayfinderTrackerMap> {
		return this.#adapter.createMap(input);
	}
	listMaps(): Promise<WayfinderTrackerMap[]> {
		return this.#adapter.listMaps();
	}
	createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket> {
		return this.#adapter.createChildTicket(input);
	}
	getMap(id: string): Promise<WayfinderTrackerMap> {
		return this.#adapter.getMap(id);
	}
	getTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#adapter.getTicket(id);
	}
	getTicketBody(id: string): Promise<WayfinderTrackerTicket> {
		return this.#adapter.getTicketBody(id);
	}
	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		return this.#adapter.listChildTickets(mapId);
	}
	listChildTicketBodies(mapId: string): Promise<WayfinderTrackerTicket[]> {
		return this.#adapter.listChildTicketBodies(mapId);
	}
	writeMapDecisions(
		mapId: string,
		decisions: DecisionSummary[],
	): Promise<WayfinderTrackerMap> {
		return this.#adapter.writeMapDecisions(mapId, decisions);
	}
	writeMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return this.#adapter.writeMapSection(mapId, section, content);
	}
	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		return this.#adapter.claimTicketIfUnclaimed(id, claimant);
	}
	unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#adapter.unclaimTicket(id);
	}
	closeTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#adapter.closeTicket(id);
	}
	recordResolution(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket> {
		return this.#adapter.recordResolution(id, resolution);
	}
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		return this.#adapter.setBlockingDependencies(id, blockerIds);
	}
}

function createLocalTrackerContext(rootDir: string): LocalTrackerContext {
	return { persistence: new LocalMarkdownAdapter(rootDir) };
}

/** Build the complete local tracker from one private, shared storage context. */
export function createLocalTrackerModules(rootDir: string): TrackerModules {
	const context = createLocalTrackerContext(rootDir);
	return {
		issues: new IssueModule(new LocalIssuePersistence(context.persistence)),
		wayfinder: new WayfinderModule(
			new LocalWayfinderPersistence(context.persistence),
		),
	};
}
