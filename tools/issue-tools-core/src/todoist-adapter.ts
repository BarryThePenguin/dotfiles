import {
	WAYFINDER_MAP_LABEL,
	todoistLabelToTicketType,
	ticketTypeToTodoistLabel,
} from "./labels.ts";
import {
	parseMapBody,
	renderMapBody,
	replaceMapSection,
	type MapSectionKey,
} from "./map-body.ts";
import type {
	CreateIssueInput,
	Issue,
	ListIssuesFilter,
	UpdateIssueLabelsInput,
} from "./issue.ts";
import { filterIssues } from "./issue-filter.ts";
import {
	parseTicketBody,
	renderTicketBody,
	setBlockedBySection,
	setClaimedBy,
	type BlockerRef,
} from "./ticket-body.ts";
import type { DecisionSummary, TicketType } from "./schema.ts";
import { canClaimTicket } from "./tracker-operations.ts";
import { WayfinderModule } from "./modules.ts";
import {
	ClosedTicketWithoutResolutionError,
	type CreateWayfinderChildTicketInput,
	type CreateWayfinderMapInput,
	type WayfinderClaimResult,
	type WayfinderTicketStatus,
	type WayfinderTrackerMap,
	type WayfinderTrackerTicket,
} from "./tracker.ts";

export type TodoistMap = WayfinderTrackerMap;
export type TodoistTicket = WayfinderTrackerTicket;

export type TodoistTaskComment = {
	content: string;
	postedAt: string | null;
};

export type TodoistTask = {
	id: string;
	url: string;
	content: string;
	description: string;
	labels: string[];
	parentId: string | null;
	projectId: string | null;
	isCompleted: boolean;
	createdAt: string | null;
	updatedAt: string | null;
	comments: TodoistTaskComment[];
};

export type TodoistCreateTaskInput = {
	content: string;
	description: string;
	labels: string[];
	projectId?: string;
	parentId?: string;
};

export type TodoistUpdateTaskInput = {
	description?: string;
	addLabels?: string[];
	removeLabels?: string[];
};

export type TodoistListTasksInput = {
	labels?: string[];
};

export interface TodoistGateway {
	createTask(input: TodoistCreateTaskInput): Promise<TodoistTask>;
	getTask(id: string): Promise<TodoistTask>;
	getTasks(ids: string[]): Promise<TodoistTask[]>;
	updateTask(id: string, input: TodoistUpdateTaskInput): Promise<TodoistTask>;
	completeTask(id: string, comment?: string): Promise<TodoistTask>;
	listTasks(input?: TodoistListTasksInput): Promise<TodoistTask[]>;
	listSubtasks(parentId: string): Promise<TodoistTask[]>;
	addComment(taskId: string, body: string): Promise<void>;
}

export type TodoistTrackerOptions = {
	projectId?: string;
};

function taskStatus(task: TodoistTask): WayfinderTicketStatus {
	return task.isCompleted ? "closed" : "open";
}

function ticketTypeFromLabels(labels: string[]): TicketType {
	for (const label of labels) {
		const type = todoistLabelToTicketType(label);
		if (type) {
			return type;
		}
	}
	throw new Error(`Todoist task is missing a Wayfinder ticket type label`);
}

function toMap(task: TodoistTask): WayfinderTrackerMap {
	return {
		id: task.id,
		title: task.content,
		url: task.url,
		...parseMapBody(task.description),
	};
}

function toTicket(task: TodoistTask): WayfinderTrackerTicket {
	const parsed = parseTicketBody(task.description);
	return {
		id: task.id,
		mapId: task.parentId ?? "",
		title: task.content,
		type: ticketTypeFromLabels(task.labels),
		question: parsed.question,
		blockerIds: parsed.blockerIds,
		...(parsed.claimedBy ? { claimedBy: parsed.claimedBy } : {}),
		url: task.url,
		status: taskStatus(task),
		comments: task.comments.map((comment) => comment.content),
	};
}

function sortById<T extends { id: string }>(records: T[]): T[] {
	return records.toSorted((a, b) =>
		a.id.localeCompare(b.id, undefined, { numeric: true }),
	);
}

/** Persistence adapter for the Todoist Issue tracker. */
export class TodoistTracker {
	readonly #gateway: TodoistGateway;
	readonly #projectId: string | undefined;

	constructor(gateway: TodoistGateway, options: TodoistTrackerOptions) {
		this.#gateway = gateway;
		this.#projectId = options.projectId;
	}

	async createMap(
		input: CreateWayfinderMapInput,
	): Promise<WayfinderTrackerMap> {
		const task = await this.#gateway.createTask({
			content: input.title,
			description: renderMapBody({
				destination: input.destination,
				notes: input.notes ?? "",
				decisionsSoFar: [],
				notYetSpecified: input.notYetSpecified ?? [],
				outOfScope: [],
			}),
			labels: [WAYFINDER_MAP_LABEL],
			...(this.#projectId ? { projectId: this.#projectId } : {}),
		});
		return toMap(task);
	}

	async listMaps(): Promise<WayfinderTrackerMap[]> {
		return sortById(
			await this.#gateway.listTasks({ labels: [WAYFINDER_MAP_LABEL] }),
		)
			.filter((task) => !task.isCompleted)
			.map(toMap);
	}

	async createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket> {
		await this.#gateway.getTask(input.mapId);
		const blockerIds = input.blockerIds ?? [];
		const blockerTasks =
			blockerIds.length > 0 ? await this.#gateway.getTasks(blockerIds) : [];
		const blockers: BlockerRef[] = blockerTasks.map((task) => ({
			id: task.id,
			title: task.content,
			url: task.url,
		}));
		const task = await this.#gateway.createTask({
			content: input.title,
			description: renderTicketBody({
				question: input.question,
				blockers,
			}),
			labels: [ticketTypeToTodoistLabel(input.type)],
			...(this.#projectId ? { projectId: this.#projectId } : {}),
			parentId: input.mapId,
		});
		return toTicket(task);
	}

	async getMap(id: string): Promise<WayfinderTrackerMap> {
		return toMap(await this.#gateway.getTask(id));
	}

	async getTicket(id: string): Promise<WayfinderTrackerTicket> {
		return toTicket(await this.#gateway.getTask(id));
	}

	async listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		await this.#gateway.getTask(mapId);
		return sortById(await this.#gateway.listSubtasks(mapId)).map(toTicket);
	}

	async listFrontierTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		return new WayfinderModule(this).listFrontierTickets(mapId);
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		const ticket = await this.getTicket(id);
		if (!canClaimTicket(ticket)) {
			return { claimed: false, ticket };
		}

		const task = await this.#gateway.getTask(id);
		await this.#gateway.updateTask(id, {
			description: setClaimedBy(task.description, claimant),
		});
		return { claimed: true, ticket: await this.getTicket(id) };
	}

	async unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		const task = await this.#gateway.getTask(id);
		return toTicket(
			await this.#gateway.updateTask(id, {
				description: setClaimedBy(task.description, undefined),
			}),
		);
	}

	async closeTicket(id: string): Promise<WayfinderTrackerTicket> {
		return toTicket(await this.#gateway.completeTask(id));
	}

	async resolveTicket(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket> {
		if (resolution.length === 0) {
			throw new Error("Resolution must not be empty.");
		}

		const task = await this.#gateway.getTask(id);
		const matchingResolution = task.comments.some(
			(comment) => comment.content === resolution,
		);
		if (task.isCompleted) {
			if (!matchingResolution) {
				throw new ClosedTicketWithoutResolutionError(id);
			}
			return toTicket(task);
		}

		// If a prior attempt persisted the native comment before completion was
		// observed, finish the retry without adding a duplicate comment.
		return toTicket(
			await this.#gateway.completeTask(
				id,
				matchingResolution ? undefined : resolution,
			),
		);
	}
	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		const blockerTasks = await this.#gateway.getTasks(blockerIds);
		const blockers: BlockerRef[] = blockerTasks.map((task) => ({
			id: task.id,
			title: task.content,
			url: task.url,
		}));
		const task = await this.#gateway.getTask(id);
		return toTicket(
			await this.#gateway.updateTask(id, {
				description: setBlockedBySection(task.description, blockers),
			}),
		);
	}

	async addBlockingDependency(
		id: string,
		blockerId: string,
	): Promise<WayfinderTrackerTicket> {
		return new WayfinderModule(this).addBlockingDependency(id, blockerId);
	}

	async readMapBody(mapId: string): Promise<string> {
		return (await this.#gateway.getTask(mapId)).description;
	}

	async writeMapBody(
		mapId: string,
		body: string,
	): Promise<WayfinderTrackerMap> {
		return toMap(
			await this.#gateway.updateTask(mapId, {
				description: body,
			}),
		);
	}

	async writeMapDecisions(
		mapId: string,
		decisions: DecisionSummary[],
	): Promise<WayfinderTrackerMap> {
		const current = parseMapBody(await this.readMapBody(mapId));
		return this.writeMapBody(
			mapId,
			renderMapBody({ ...current, decisionsSoFar: decisions }),
		);
	}

	async writeMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return this.writeMapBody(
			mapId,
			replaceMapSection(await this.readMapBody(mapId), section, content),
		);
	}

	async recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<WayfinderTrackerMap> {
		return new WayfinderModule(this).recordDecision(mapId, decision);
	}

	async updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return new WayfinderModule(this).updateMapSection(mapId, section, content);
	}

	// -- Generic issue surface -------------------------------------------

	async createIssue(input: CreateIssueInput): Promise<Issue> {
		const labels = input.labels ?? [];
		const task = await this.#gateway.createTask({
			content: input.title,
			description: input.body ?? "",
			labels,
			...(this.#projectId ? { projectId: this.#projectId } : {}),
		});
		return toIssue(task);
	}

	async readIssue(id: string): Promise<Issue> {
		return toIssue(await this.#gateway.getTask(extractTodoistTaskId(id)));
	}

	async updateIssueLabels(
		id: string,
		input: UpdateIssueLabelsInput,
	): Promise<Issue> {
		const taskId = extractTodoistTaskId(id);
		const update: {
			addLabels?: string[];
			removeLabels?: string[];
		} = {};
		if (input.add) {
			update.addLabels = [...input.add];
		}
		if (input.remove) {
			update.removeLabels = [...input.remove];
		}
		const updated = await this.#gateway.updateTask(taskId, update);
		return toIssue(updated);
	}

	async commentOnIssue(
		id: string,
		body: string,
	): Promise<{ comment: { content: string; postedAt?: string } }> {
		const taskId = extractTodoistTaskId(id);
		await this.#gateway.addComment(taskId, body);
		const updated = await this.#gateway.getTask(taskId);
		const lastComment = updated.comments.at(-1);
		return {
			comment: {
				content: body,
				...(lastComment?.postedAt ? { postedAt: lastComment.postedAt } : {}),
			},
		};
	}

	async closeIssue(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }> {
		const taskId = extractTodoistTaskId(id);
		await this.#gateway.completeTask(taskId, options?.comment);
		return { status: "closed" as const };
	}

	async listIssues(filter: ListIssuesFilter): Promise<Issue[]> {
		const tasks = await this.#gateway.listTasks();
		const scoped = this.#projectId
			? tasks.filter((task) => task.projectId === this.#projectId)
			: tasks;
		return filterIssues(scoped.map(toIssue), filter);
	}
}

function toIssue(task: TodoistTask): Issue {
	return {
		id: task.id,
		url: task.url,
		title: task.content,
		body: task.description,
		labels: task.labels,
		status: taskStatus(task),
		comments: task.comments.map((comment) => ({
			content: comment.content,
			...(comment.postedAt ? { postedAt: comment.postedAt } : {}),
		})),
		...(task.createdAt ? { createdAt: task.createdAt } : {}),
		...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
	};
}

const TODOIST_TASK_ID_FROM_URL = /\/app\/task\/([A-Za-z0-9_-]+)\b/;

function extractTodoistTaskId(idOrUrl: string): string {
	const match = TODOIST_TASK_ID_FROM_URL.exec(idOrUrl);
	return match?.[1] ?? idOrUrl;
}

export { TodoistTracker as TodoistPersistenceAdapter };
