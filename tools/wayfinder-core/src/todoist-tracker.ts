import {
	WAYFINDER_MAP_LABEL,
	todoistLabelToTicketType,
	ticketTypeToTodoistLabel,
} from "./labels.ts";
import {
	appendDecision,
	parseMapBody,
	replaceMapSection,
	renderMapBody,
	type MapSectionKey,
} from "./map-body.ts";
import { getMetadata, removeMetadata, setMetadata } from "./metadata.ts";
import { parseTicketBody, renderTicketBody } from "./ticket-body.ts";
import type {
	DecisionSummary,
	ParsedMapBody,
	TicketType,
	WayfinderTicket,
} from "./schema.ts";
import type {
	CreateLocalChildTicketInput,
	CreateLocalMapInput,
	LocalClaimResult,
	LocalMap,
	LocalTicket,
	LocalTicketStatus,
} from "./local-tracker.ts";

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
	updateTask(id: string, input: TodoistUpdateTaskInput): Promise<TodoistTask>;
	completeTask(id: string): Promise<TodoistTask>;
	listTasks(input?: TodoistListTasksInput): Promise<TodoistTask[]>;
	listSubtasks(parentId: string): Promise<TodoistTask[]>;
	addComment(taskId: string, body: string): Promise<void>;
}

export type TodoistTrackerOptions = {
	projectId?: string;
};

function taskStatus(task: TodoistTask): LocalTicketStatus {
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

function toMap(task: TodoistTask): LocalMap {
	return {
		id: task.id,
		title: task.content,
		url: task.url,
		...parseMapBody(task.description),
	};
}

function toTicket(task: TodoistTask): LocalTicket {
	const parsed = parseTicketBody(task.description);
	return {
		id: task.id,
		mapId: parsed.mapId ?? task.parentId ?? "",
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

	async createMap(input: CreateLocalMapInput): Promise<LocalMap> {
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

	async listMaps(): Promise<LocalMap[]> {
		return sortById(
			await this.#gateway.listTasks({ labels: [WAYFINDER_MAP_LABEL] }),
		)
			.filter((task) => !task.isCompleted)
			.map(toMap);
	}

	async createChildTicket(
		input: CreateLocalChildTicketInput,
	): Promise<LocalTicket> {
		await this.#gateway.getTask(input.mapId);
		const task = await this.#gateway.createTask({
			content: input.title,
			description: renderTicketBody({
				question: input.question,
				mapId: input.mapId,
				blockerIds: input.blockerIds ?? [],
			}),
			labels: [ticketTypeToTodoistLabel(input.type)],
			...(this.#projectId ? { projectId: this.#projectId } : {}),
			parentId: input.mapId,
		});
		return toTicket(task);
	}

	async getMap(id: string): Promise<LocalMap> {
		return toMap(await this.#gateway.getTask(id));
	}

	async getTicket(id: string): Promise<LocalTicket> {
		return toTicket(await this.#gateway.getTask(id));
	}

	async listChildTickets(mapId: string): Promise<LocalTicket[]> {
		await this.#gateway.getTask(mapId);
		return sortById(await this.#gateway.listSubtasks(mapId)).map(toTicket);
	}

	async listFrontierTickets(mapId: string): Promise<LocalTicket[]> {
		const tickets = await this.listChildTickets(mapId);
		const frontier: LocalTicket[] = [];

		for (const ticket of tickets) {
			if (ticket.status !== "open" || ticket.claimedBy) {
				continue;
			}
			const blockers = await Promise.all(
				ticket.blockerIds.map((blockerId) => this.getTicket(blockerId)),
			);
			if (blockers.every((blocker) => blocker.status === "closed")) {
				frontier.push(ticket);
			}
		}

		return frontier;
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<LocalClaimResult> {
		const ticket = await this.getTicket(id);
		if (ticket.status !== "open" || ticket.claimedBy) {
			return { claimed: false, ticket };
		}

		const task = await this.#gateway.getTask(id);
		await this.#gateway.updateTask(id, {
			description: setMetadata(task.description, "claimed-by", [claimant]),
		});
		return { claimed: true, ticket: await this.getTicket(id) };
	}

	async unclaimTicket(id: string): Promise<LocalTicket> {
		const task = await this.#gateway.getTask(id);
		return toTicket(
			await this.#gateway.updateTask(id, {
				description: removeMetadata(task.description, "claimed-by"),
			}),
		);
	}

	async closeTicket(id: string): Promise<LocalTicket> {
		return toTicket(await this.#gateway.completeTask(id));
	}

	async postComment(id: string, body: string): Promise<void> {
		await this.#gateway.addComment(id, body);
	}

	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<LocalTicket> {
		await Promise.all(
			blockerIds.map((blockerId) => this.#gateway.getTask(blockerId)),
		);
		const task = await this.#gateway.getTask(id);
		return toTicket(
			await this.#gateway.updateTask(id, {
				description: setMetadata(task.description, "blocked-by", blockerIds),
			}),
		);
	}

	async addBlockingDependency(
		id: string,
		blockerId: string,
	): Promise<LocalTicket> {
		const task = await this.#gateway.getTask(id);
		const blockerIds = new Set(getMetadata(task.description, "blocked-by"));
		blockerIds.add(blockerId);
		return this.setBlockingDependencies(id, Array.from(blockerIds));
	}

	async recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<LocalMap> {
		const task = await this.#gateway.getTask(mapId);
		return toMap(
			await this.#gateway.updateTask(mapId, {
				description: appendDecision(task.description, decision),
			}),
		);
	}

	async updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<LocalMap> {
		const task = await this.#gateway.getTask(mapId);
		return toMap(
			await this.#gateway.updateTask(mapId, {
				description: replaceMapSection(task.description, section, content),
			}),
		);
	}
}

export class InMemoryTodoistGateway implements TodoistGateway {
	readonly tasks = new Map<string, TodoistTask>();
	#nextTaskNumber = 1;

	createTask(input: TodoistCreateTaskInput): Promise<TodoistTask> {
		const id = String(this.#nextTaskNumber++);
		const task: TodoistTask = {
			id,
			url: `https://app.todoist.com/app/task/${id}`,
			content: input.content,
			description: input.description,
			labels: input.labels,
			parentId: input.parentId ?? null,
			projectId: input.projectId ?? null,
			isCompleted: false,
			comments: [],
		};
		this.tasks.set(id, task);
		return Promise.resolve(task);
	}

	getTask(id: string): Promise<TodoistTask> {
		const task = this.tasks.get(id);
		if (!task) {
			return Promise.reject(new Error(`Todoist task not found: ${id}`));
		}
		return Promise.resolve(task);
	}

	async updateTask(
		id: string,
		input: TodoistUpdateTaskInput,
	): Promise<TodoistTask> {
		const task = await this.getTask(id);
		const updated: TodoistTask = {
			...task,
			...(input.description !== undefined
				? { description: input.description }
				: {}),
			...(input.labels !== undefined ? { labels: input.labels } : {}),
		};
		this.tasks.set(id, updated);
		return updated;
	}

	async completeTask(id: string): Promise<TodoistTask> {
		const task = await this.getTask(id);
		const updated = { ...task, isCompleted: true };
		this.tasks.set(id, updated);
		return updated;
	}

	listTasks(input: TodoistListTasksInput = {}): Promise<TodoistTask[]> {
		let tasks = Array.from(this.tasks.values());
		if (input.labels) {
			tasks = tasks.filter((task) =>
				input.labels?.every((label) => task.labels.includes(label)),
			);
		}
		return Promise.resolve(tasks);
	}

	listSubtasks(parentId: string): Promise<TodoistTask[]> {
		return Promise.resolve(
			Array.from(this.tasks.values()).filter(
				(task) => task.parentId === parentId,
			),
		);
	}

	async addComment(taskId: string, body: string): Promise<void> {
		const task = await this.getTask(taskId);
		task.comments.push(body);
	}
}

export type TodoistMap = ParsedMapBody & {
	id: string;
	title: string;
	url: string;
};

export type TodoistTicket = WayfinderTicket & {
	url: string;
	status: LocalTicketStatus;
	comments: string[];
};
