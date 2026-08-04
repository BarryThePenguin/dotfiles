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
import { parseMapBody, renderMapBody, replaceMapSection } from "./map-body.ts";
import type { MapSectionKey } from "./schema.ts";
import type { ResolutionState, ResolutionTarget } from "./persistence.ts";
import type { CreateIssueInput, Issue } from "./issue.ts";
import {
	parseTicketBody,
	renderTicketBody,
	setBlockedBySection,
	setClaimedBy,
} from "./ticket-body.ts";
import type { BlockerLink, DecisionSummary, TicketType } from "./schema.ts";
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

type TodoistTaskWithNotes = AppTask & {
	notes: { content: string; postedAt: string | null }[];
};

function withComments(task: TodoistTaskWithNotes): TodoistTaskRead {
	return {
		...task,
		description: task.description ?? "",
		comments: task.notes,
	};
}

function withExistingComments(
	task: AppTask,
	comments: TodoistTaskRead["comments"],
): TodoistTaskRead {
	return {
		...task,
		description: task.description ?? "",
		comments,
	};
}

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
		blockerIds: parsed.blockers.map((blocker) =>
			blockerIdFromLink(blocker.url),
		),
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
		return toMap(this.#withoutComments(result));
	}

	listMaps(): Promise<WayfinderTrackerMap[]> {
		const tasks = this.#selectTasks({
			completed: "incomplete",
			label: WAYFINDER_MAP_LABEL,
		});
		return Promise.resolve(
			sortById(tasks).map((task) => toMap(this.#withoutComments(task))),
		);
	}

	async createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket> {
		this.#readTaskBody(input.mapId);
		const blockerIds = input.blockerIds ?? [];
		const blockerTasks =
			blockerIds.length > 0
				? blockerIds.map((id) => this.#readTaskBody(id))
				: [];
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
		return toTicket(this.#withoutComments(result));
	}

	getMap(id: string): Promise<WayfinderTrackerMap> {
		return Promise.resolve(toMap(this.#readTaskBody(id)));
	}

	getTicket(id: string): Promise<WayfinderTrackerTicket> {
		return Promise.resolve(toTicket(this.#readTask(id)));
	}

	getTicketMetadata(id: string): Promise<WayfinderTrackerTicket> {
		return Promise.resolve(toTicket(this.#readTaskBody(id)));
	}

	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		const tasks = this.#db.selectTasksWithNotes({
			completed: "any",
			parentId: mapId,
		});
		return Promise.resolve(sortById(tasks).map(withComments).map(toTicket));
	}

	listChildTicketMetadata(mapId: string): Promise<WayfinderTrackerTicket[]> {
		const tasks = this.#selectTasks({ completed: "any", parentId: mapId });
		return Promise.resolve(
			sortById(tasks).map((task) => toTicket(this.#withoutComments(task))),
		);
	}

	async readResolutionTarget(ticketId: string): Promise<ResolutionTarget> {
		const ticket = await this.getTicket(ticketId);
		return { ticket, map: await this.getMap(ticket.mapId) };
	}

	async readResolutionState(mapId: string): Promise<ResolutionState> {
		const [map, siblings] = await Promise.all([
			this.getMap(mapId),
			this.listChildTickets(mapId),
		]);
		return { map, siblings };
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		const task = this.#readTask(id);
		const ticket = toTicket(task);
		if (!canClaimTicket(ticket)) {
			return { claimed: false, ticket };
		}

		const { result } = await updateTask(this.#db, this.#client, id, {
			description: setClaimedBy(task.description, claimant),
		});
		return {
			claimed: true,
			ticket: toTicket(withExistingComments(result, task.comments)),
		};
	}

	async unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		const task = this.#readTask(id);
		const { result } = await updateTask(this.#db, this.#client, id, {
			description: setClaimedBy(task.description, undefined),
		});
		return toTicket(withExistingComments(result, task.comments));
	}

	async closeTicket(id: string): Promise<WayfinderTrackerTicket> {
		const task = this.#readTask(id);
		await completeTask(this.#db, this.#client, id);
		return toTicket({ ...task, isCompleted: true });
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
		// observed, finish the retry without adding a duplicate comment. Reuse
		// the nested read rather than loading the task's comments again after the
		// mutation.
		await completeTask(
			this.#db,
			this.#client,
			id,
			matchingResolution ? undefined : resolution,
		);
		return toTicket({
			...task,
			isCompleted: true,
			comments: matchingResolution
				? task.comments
				: [...task.comments, { content: resolution, postedAt: null }],
		});
	}
	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		const blockerTasks = blockerIds.map((blockerId) =>
			this.#readTaskBody(blockerId),
		);
		const blockers: BlockerLink[] = blockerTasks.map((task) => ({
			text: task.content,
			url: task.url,
		}));
		const task = this.#readTaskBody(id);
		const { result } = await updateTask(this.#db, this.#client, id, {
			description: setBlockedBySection(task.description, blockers),
		});
		return toTicket(this.#withoutComments(result));
	}

	#readMapBody(mapId: string): string {
		return this.#readTaskBody(mapId).description;
	}

	async #writeMapBody(
		mapId: string,
		body: string,
	): Promise<WayfinderTrackerMap> {
		const { result } = await updateTask(this.#db, this.#client, mapId, {
			description: body,
		});
		return toMap(this.#withoutComments(result));
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
		return toIssue(this.#withoutComments(result));
	}

	readIssueRecord(id: string): Promise<Issue> {
		return Promise.resolve(toIssue(this.#readTask(extractTodoistTaskId(id))));
	}

	async writeIssueLabels(
		id: string,
		labels: string[],
		currentIssue: Issue,
	): Promise<Issue> {
		const taskId = extractTodoistTaskId(id);
		const currentLabels = new Set(currentIssue.labels);
		const nextLabels = new Set(labels);
		const removeLabels = currentIssue.labels.filter(
			(label) => !nextLabels.has(label),
		);
		const addLabels = labels.filter((label) => !currentLabels.has(label));
		if (addLabels.length === 0 && removeLabels.length === 0) {
			return currentIssue;
		}
		const { result } = await updateTask(this.#db, this.#client, taskId, {
			...(addLabels.length > 0 ? { addLabels } : {}),
			...(removeLabels.length > 0 ? { removeLabels } : {}),
		});
		const comments = currentIssue.comments.map((comment) => ({
			content: comment.content,
			postedAt: comment.postedAt ?? null,
		}));
		return toIssue(withExistingComments(result, comments));
	}

	async appendIssueComment(
		id: string,
		body: string,
	): Promise<{ comment: { content: string; postedAt?: string } }> {
		const taskId = extractTodoistTaskId(id);
		const { result } = await addTaskComment(
			this.#db,
			this.#client,
			taskId,
			body,
		);
		return {
			comment: {
				content: body,
				...(result.postedAt ? { postedAt: result.postedAt } : {}),
			},
		};
	}

	async closeIssueRecord(
		id: string,
		options: { comment?: string } | undefined,
	): Promise<{ status: "open" | "closed" }> {
		const taskId = extractTodoistTaskId(id);
		await completeTask(this.#db, this.#client, taskId, options?.comment);
		return { status: "closed" as const };
	}

	listIssueRecords(): Promise<Issue[]> {
		const tasks = this.#db.selectTasksWithNotes({
			completed: "any",
			...(this.#projectId ? { projectId: this.#projectId } : {}),
		});
		return Promise.resolve(tasks.map(withComments).map(toIssue));
	}

	// -- doist-core reads -------------------------------------------------

	#selectTasks(criteria?: Parameters<Database["selectTasks"]>[0]): AppTask[] {
		return this.#db.selectTasks(criteria ?? { completed: "any" });
	}

	#withoutComments(task: AppTask): TodoistTaskRead {
		return {
			...task,
			description: task.description ?? "",
			comments: [],
		};
	}

	#readTaskBody(id: string): TodoistTaskRead {
		const task = this.#db.getTaskById(id);
		if (!task) {
			throw new Error(`Todoist task not found: ${id}`);
		}
		return this.#withoutComments(task);
	}

	#readTask(id: string): TodoistTaskRead {
		const task = this.#db.getTaskWithNotes(id);
		if (!task) {
			throw new Error(`Todoist task not found: ${id}`);
		}
		return withComments(task);
	}
}

const TODOIST_TASK_PATH = /\/app\/task\/([^/?#]+)/;
const TODOIST_TASK_ID_SUFFIX = /-([A-Za-z0-9]+)$/;

function extractTodoistTaskId(idOrUrl: string): string {
	const pathMatch = TODOIST_TASK_PATH.exec(idOrUrl);
	if (!pathMatch?.[1]) {
		return idOrUrl;
	}
	return TODOIST_TASK_ID_SUFFIX.exec(pathMatch[1])?.[1] ?? pathMatch[1];
}

// Wayfinder writes the blocked-by section as links whose URL ends in the
// blocker's task id (the last path segment). Since we control the format, we
// parse exactly that.
function blockerIdFromLink(url: string): string {
	return new URL(url).pathname.split("/").at(-1) ?? "";
}
