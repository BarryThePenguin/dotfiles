import {
	createContainer,
	selectRepoProject,
	syncAndPersist,
	type Container,
} from "doist-core";
import { IssueModule, WayfinderModule } from "./modules.ts";
import type {
	IssuePersistence,
	TrackerModules,
	WayfinderPersistence,
} from "./modules.ts";
import { TodoistAdapter } from "./todoist-adapter.ts";
import type { CreateIssueInput, Issue, IssueComment } from "./issue.ts";
import type {
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	WayfinderClaimResult,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";
import type { MapSectionKey } from "./schema.ts";
import type { DecisionSummary } from "./schema.ts";

/**
 * The private Todoist context is the only owner of storage coordination.
 * Domain factories receive narrow views of it, so an Issue tracker cannot
 * accidentally acquire Wayfinder behavior (or vice versa).
 */
type TodoistTrackerContext = {
	readonly persistence: TodoistAdapter;
};

class TodoistIssuePersistence implements IssuePersistence {
	readonly #adapter: TodoistAdapter;

	constructor(adapter: TodoistAdapter) {
		this.#adapter = adapter;
	}

	createIssueRecord(input: CreateIssueInput): Promise<Issue> {
		return this.#adapter.createIssueRecord(input);
	}
	readIssueRecord(id: string): Promise<Issue> {
		return this.#adapter.readIssueRecord(id);
	}
	writeIssueLabels(
		id: string,
		labels: string[],
		current?: Issue,
	): Promise<Issue> {
		return this.#adapter.writeIssueLabels(id, labels, current);
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

class TodoistWayfinderPersistence implements WayfinderPersistence {
	readonly #adapter: TodoistAdapter;

	constructor(adapter: TodoistAdapter) {
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

function createTodoistIssueTracker(context: TodoistTrackerContext) {
	return new IssueModule(new TodoistIssuePersistence(context.persistence));
}

function createTodoistWayfinderTracker(context: TodoistTrackerContext) {
	return new WayfinderModule(
		new TodoistWayfinderPersistence(context.persistence),
	);
}

function repoProjectId(container: Container): string | undefined {
	if (!container.paths) {
		return undefined;
	}
	return selectRepoProject(container.listProjects())?.id;
}

async function createTodoistTrackerContext(): Promise<TodoistTrackerContext> {
	const container = createContainer();
	if (!container.paths) {
		throw new Error("Could not create Todoist tracker: no-config");
	}
	const projectIds = container.listProjectIds();
	if (projectIds.length === 0) {
		throw new Error("Could not create Todoist tracker: no-projects");
	}

	await syncAndPersist(container.db, container.client, projectIds, false);
	const projectId = repoProjectId(container);
	return {
		persistence: new TodoistAdapter(
			container.db,
			container.client,
			projectId ? { projectId } : {},
		),
	};
}

/** Build the complete module set backed by one synchronized Todoist context. */
export async function createTodoistTrackerModules(): Promise<TrackerModules> {
	const context = await createTodoistTrackerContext();
	return {
		issues: createTodoistIssueTracker(context),
		wayfinder: createTodoistWayfinderTracker(context),
	};
}

/** Select the configured repository project for callers that need to inspect it. */
export function selectTodoistRepoProjectId(
	container: Container,
): string | undefined {
	return repoProjectId(container);
}
