import {
	addTask,
	addTaskComment,
	completeTask,
	updateTask,
	type AppTask,
	type Database,
	type TodoistClient,
} from "doist-core";
import {
	WAYFINDER_MAP_LABEL,
	todoistLabelToTicketType,
	ticketTypeToTodoistLabel,
} from "./labels.ts";
import {
	parseMapBody,
	renderMapBody,
	replaceMapSection,
} from "./map-body.ts";
import type { MapSectionKey } from "./schema.ts";
import type { CreateIssueInput, Issue } from "./issue.ts";
import {
	parseTicketBody,
	renderTicketBody,
	setBlockedBySection,
	setClaimedBy,
} from "./ticket-body.ts";
import type {
	BlockerLink,
	DecisionSummary,
	TicketType,
} from "./schema.ts";
import { canClaimTicket } from "./tracker-operations.ts";
import {
	ClosedTicketWithoutResolutionError,
	type CreateWayfinderChildTicketInput,
	type CreateWayfinderMapInput,
	type WayfinderClaimResult,
	type WayfinderTicketStatus,
	type WayfinderTrackerMap,
	type WayfinderTrackerTicket,
} from "./tracker.ts";

export type TodoistAdapterOptions = {
	projectId?: string;
};

/**
 * A Todoist task as the adapter reads it: the doist-core AppTask plus its
 * comments, with the description normalized to a string. This is the adapter's
 * internal read shape — the public surface only ever exposes domain records.
 */
type TodoistTaskRead = AppTask & {
	description: string;
	comments: { content: string; postedAt: string | null }[];
};

function taskStatus(task: TodoistTaskRead): WayfinderTicketStatus {
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

function toMap(task: TodoistTaskRead): WayfinderTrackerMap {
	return {
		id: task.id,
		title: task.content,
		url: task.url,
		...parseMapBody(task.description),
	};
}

function toTicket(task: TodoistTaskRead): WayfinderTrackerTicket {
	const parsed = parseTicketBody(task.description);
	return {
		id: task.id,
		mapId: task.parentId ?? "",
		title: task.content,
		type: ticketTypeFromLabels(task.labels),
		question: parsed.question,
		blockerIds: parsed.blockers.map((blocker) => blockerIdFromLink(blocker.url)),
		...(parsed.claimedBy ? { claimedBy: parsed.claimedBy } : {}),
		url: task.url,
		status: taskStatus(task),
		comments: task.comments.map((comment) => comment.content),
	};
}

function toIssue(task: TodoistTaskRead): Issue {
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

function sortById<T extends { id: string }>(records: T[]): T[] {
	return records.toSorted((a, b) =>
		a.id.localeCompare(b.id, undefined, { numeric: true }),
	);
}

/**
 * Persistence adapter for the Todoist Issue tracker. Speaks doist-core's
 * operations and synchronized database snapshot directly — there is no
 * intermediate task shape between AppTask and the domain records.
 */
export class TodoistAdapter {
	readonly #db: Database;
	readonly #client: TodoistClient;
	readonly #projectId: string | undefined;

	constructor(
		db: Database,
		client: TodoistClient,
		options: TodoistAdapterOptions,
	) {
		this.#db = db;
		this.#client = client;
		this.#projectId = options.projectId;
	}

	async createMap(
		input: CreateWayfinderMapInput,
	): Promise<WayfinderTrackerMap> {
		const { result } = await addTask(this.#db, this.#client, {
			title: input.title,
			description: renderMapBody({
				destination: input.destination,
				notes: input.notes ?? "",
				decisionsSoFar: [],
				notYetSpecified: input.notYetSpecified ?? [],
				outOfScope: [],
			}),
			labels: [WAYFINDER_MAP_LABEL],
			...(this.#projectId ? { project: this.#projectId } : {}),
		});
		return toMap(this.#withComments(result));
	}

	listMaps(): Promise<WayfinderTrackerMap[]> {
		return Promise.resolve(
			sortById(this.#selectTasks())
				.filter(
					(task) =>
						task.labels.includes(WAYFINDER_MAP_LABEL) && !task.isCompleted,
				)
				.map((task) => toMap(this.#withComments(task))),
		);
	}

	async createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket> {
		this.#readTask(input.mapId);
		const blockerIds = input.blockerIds ?? [];
		const blockerTasks =
			blockerIds.length > 0 ? blockerIds.map((id) => this.#readTask(id)) : [];
		const blockers: BlockerLink[] = blockerTasks.map((task) => ({
			text: task.content,
			url: task.url,
		}));
		const { result } = await addTask(this.#db, this.#client, {
			title: input.title,
			description: renderTicketBody({
				question: input.question,
				blockers,
			}),
			labels: [ticketTypeToTodoistLabel(input.type)],
			...(this.#projectId ? { project: this.#projectId } : {}),
			parentId: input.mapId,
		});
		return toTicket(this.#withComments(result));
	}

	getMap(id: string): Promise<WayfinderTrackerMap> {
		return Promise.resolve(toMap(this.#readTask(id)));
	}

	getTicket(id: string): Promise<WayfinderTrackerTicket> {
		return Promise.resolve(toTicket(this.#readTask(id)));
	}

	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		this.#readTask(mapId);
		return Promise.resolve(
			sortById(this.#selectTasks().filter((task) => task.parentId === mapId)).map(
				(task) => toTicket(this.#withComments(task)),
			),
		);
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		const ticket = await this.getTicket(id);
		if (!canClaimTicket(ticket)) {
			return { claimed: false, ticket };
		}

		const task = this.#readTask(id);
		const { result } = await updateTask(this.#db, this.#client, id, {
			description: setClaimedBy(task.description, claimant),
		});
		return { claimed: true, ticket: toTicket(this.#withComments(result)) };
	}

	async unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		const task = this.#readTask(id);
		const { result } = await updateTask(this.#db, this.#client, id, {
			description: setClaimedBy(task.description, undefined),
		});
		return toTicket(this.#withComments(result));
	}

	async closeTicket(id: string): Promise<WayfinderTrackerTicket> {
		await completeTask(this.#db, this.#client, id);
		return toTicket(this.#readTask(id));
	}

	async recordResolution(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket> {
		if (resolution.length === 0) {
			throw new Error("Resolution must not be empty.");
		}

		const task = this.#readTask(id);
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
		await completeTask(
			this.#db,
			this.#client,
			id,
			matchingResolution ? undefined : resolution,
		);
		return toTicket(this.#readTask(id));
	}
	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		const blockerTasks = blockerIds.map((blockerId) => this.#readTask(blockerId));
		const blockers: BlockerLink[] = blockerTasks.map((task) => ({
			text: task.content,
			url: task.url,
		}));
		const task = this.#readTask(id);
		const { result } = await updateTask(this.#db, this.#client, id, {
			description: setBlockedBySection(task.description, blockers),
		});
		return toTicket(this.#withComments(result));
	}

	#readMapBody(mapId: string): string {
		return this.#readTask(mapId).description;
	}

	async #writeMapBody(
		mapId: string,
		body: string,
	): Promise<WayfinderTrackerMap> {
		const { result } = await updateTask(this.#db, this.#client, mapId, {
			description: body,
		});
		return toMap(this.#withComments(result));
	}

	async writeMapDecisions(
		mapId: string,
		decisions: DecisionSummary[],
	): Promise<WayfinderTrackerMap> {
		const current = parseMapBody(this.#readMapBody(mapId));
		return this.#writeMapBody(
			mapId,
			renderMapBody({ ...current, decisionsSoFar: decisions }),
		);
	}

	async writeMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		return this.#writeMapBody(
			mapId,
			replaceMapSection(this.#readMapBody(mapId), section, content),
		);
	}

	// -- Generic issue persistence --------------------------------------

	async createIssueRecord(input: CreateIssueInput): Promise<Issue> {
		const { result } = await addTask(this.#db, this.#client, {
			title: input.title,
			description: input.body ?? "",
			labels: input.labels ?? [],
			...(this.#projectId ? { project: this.#projectId } : {}),
		});
		return toIssue(this.#withComments(result));
	}

	readIssueRecord(id: string): Promise<Issue> {
		return Promise.resolve(toIssue(this.#readTask(extractTodoistTaskId(id))));
	}

	async writeIssueLabels(id: string, labels: string[]): Promise<Issue> {
		const taskId = extractTodoistTaskId(id);
		const current = this.#readTask(taskId);
		const currentLabels = new Set(current.labels);
		const nextLabels = new Set(labels);
		const removeLabels = current.labels.filter(
			(label) => !nextLabels.has(label),
		);
		const addLabels = labels.filter((label) => !currentLabels.has(label));
		if (addLabels.length === 0 && removeLabels.length === 0) {
			return toIssue(current);
		}
		const { result } = await updateTask(this.#db, this.#client, taskId, {
			...(addLabels.length > 0 ? { addLabels } : {}),
			...(removeLabels.length > 0 ? { removeLabels } : {}),
		});
		return toIssue(this.#withComments(result));
	}

	async appendIssueComment(
		id: string,
		body: string,
	): Promise<{ comment: { content: string; postedAt?: string } }> {
		const taskId = extractTodoistTaskId(id);
		const { result } = await addTaskComment(this.#db, this.#client, taskId, body);
		return {
			comment: {
				content: body,
				...(result.postedAt ? { postedAt: result.postedAt } : {}),
			},
		};
	}

	async closeIssueRecord(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }> {
		const taskId = extractTodoistTaskId(id);
		await completeTask(this.#db, this.#client, taskId, options?.comment);
		return { status: "closed" as const };
	}

	listIssueRecords(): Promise<Issue[]> {
		const tasks = this.#selectTasks();
		const scoped = this.#projectId
			? tasks.filter((task) => task.projectId === this.#projectId)
			: tasks;
		return Promise.resolve(scoped.map((task) => toIssue(this.#withComments(task))));
	}

	// -- doist-core reads -------------------------------------------------

	#selectTasks(): AppTask[] {
		return this.#db.selectTasks({ completed: "any" });
	}

	#withComments(task: AppTask): TodoistTaskRead {
		return {
			...task,
			description: task.description ?? "",
			comments: this.#db.selectNotesByTask(task.id).map((note) => ({
				content: note.content,
				postedAt: note.postedAt,
			})),
		};
	}

	#readTask(id: string): TodoistTaskRead {
		const task = this.#db.getTaskById(id);
		if (!task) {
			throw new Error(`Todoist task not found: ${id}`);
		}
		return this.#withComments(task);
	}
}

const TODOIST_TASK_ID_FROM_URL = /\/app\/task\/([A-Za-z0-9_-]+)\b/;

function extractTodoistTaskId(idOrUrl: string): string {
	const match = TODOIST_TASK_ID_FROM_URL.exec(idOrUrl);
	return match?.[1] ?? idOrUrl;
}

// Wayfinder writes the blocked-by section as links whose URL ends in the
// blocker's task id (the last path segment). Since we control the format, we
// parse exactly that.
function blockerIdFromLink(url: string): string {
	return new URL(url).pathname.split("/").at(-1) ?? "";
}
