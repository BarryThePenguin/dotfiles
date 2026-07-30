import {
	WAYFINDER_MAP_LABEL,
	todoistLabelToTicketType,
	ticketTypeToTodoistLabel,
} from "./labels.ts";
import { parseMapBody, renderMapBody, type MapSectionKey } from "./map-body.ts";
import {
	parseTicketBody,
	renderTicketBody,
	setBlockedBySection,
	setClaimedBy,
	type BlockerRef,
} from "./ticket-body.ts";
import type { DecisionSummary, TicketType } from "./schema.ts";
import {
	addBlockingDependency as addBlockingDependencyOperation,
	canClaimTicket,
	listFrontierTickets as listFrontierTicketsOperation,
	recordDecision as recordDecisionOperation,
	updateMapSection as updateMapSectionOperation,
} from "./tracker-operations.ts";
import type {
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	WayfinderClaimResult,
	WayfinderTicketStatus,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";

export type TodoistMap = WayfinderTrackerMap;
export type TodoistTicket = WayfinderTrackerTicket;

export type TodoistTask = {
	id: string;
	url: string;
	content: string;
	description: string;
	labels: string[];
	parentId: string | null;
	projectId: string | null;
	isCompleted: boolean;
	comments: string[];
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
	labels?: string[];
};

export type TodoistListTasksInput = {
	labels?: string[];
};

export interface TodoistGateway {
	createTask(input: TodoistCreateTaskInput): Promise<TodoistTask>;
	getTask(id: string): Promise<TodoistTask>;
	getTasks(ids: string[]): Promise<TodoistTask[]>;
	updateTask(id: string, input: TodoistUpdateTaskInput): Promise<TodoistTask>;
	completeTask(id: string): Promise<TodoistTask>;
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
		comments: task.comments,
	};
}

function sortById<T extends { id: string }>(records: T[]): T[] {
	return records.toSorted((a, b) =>
		a.id.localeCompare(b.id, undefined, { numeric: true }),
	);
}

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
		return listFrontierTicketsOperation(this, mapId);
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

	async postComment(id: string, body: string): Promise<void> {
		await this.#gateway.addComment(id, body);
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
		return addBlockingDependencyOperation(this, id, blockerId);
	}

	async recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<WayfinderTrackerMap> {
		return recordDecisionOperation(this.#mapBodyAccessor(), mapId, decision);
	}

	async updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return updateMapSectionOperation(
			this.#mapBodyAccessor(),
			mapId,
			section,
			content,
		);
	}

	#mapBodyAccessor() {
		return {
			readMapBody: async (id: string) =>
				(await this.#gateway.getTask(id)).description,
			writeMapBody: async (id: string, body: string) =>
				toMap(
					await this.#gateway.updateTask(id, {
						description: body,
					}),
				),
		};
	}
}
