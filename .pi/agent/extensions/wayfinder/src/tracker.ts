/**
 * Todoist tracker for Wayfinder — shells out to the `doist` CLI.
 *
 * Operations needed:
 * - CRUD on tasks (maps and tickets)
 * - Comments (resolution records)
 * - Labels (wayfinder metadata)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	projectId: string | null;
	sectionId: string | null;
	parentId: string | null;
	order: number;
	priority: number;
	due: { date: string; string: string; isRecurring: boolean } | null;
	labels: string[];
	isCompleted: boolean;
	url: string;
}

export interface TodoistComment {
	id: string;
	task_id: string;
	content: string;
	posted_at: string;
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

async function doist(args: string[]): Promise<string> {
	const { stdout, stderr } = await exec("doist", args);
	if (stderr) {
		console.error("doist stderr:", stderr);
	}
	return stdout.trim();
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class TodoistClient {
	// -- Tasks ---------------------------------------------------------------

	async getTask(id: string): Promise<TodoistTask> {
		const output = await doist(["tasks", "get", id]);
		return JSON.parse(output) as TodoistTask;
	}

	async createTask(fields: {
		content: string;
		description?: string;
		projectId?: string;
		sectionId?: string;
		parentId?: string;
		labels?: string[];
		priority?: number;
		order?: number;
	}): Promise<TodoistTask> {
		const args = ["tasks", "add", "--title", fields.content];

		if (fields.description) {
			args.push("--description", fields.description);
		}

		if (fields.parentId) {
			args.push("--parent", fields.parentId);
		}

		if (fields.labels && fields.labels.length > 0) {
			args.push("--label", fields.labels.join(","));
		}

		const result = await doist(args);
		const parsed = JSON.parse(result) as
			{ ok: boolean; result: TodoistTask } | TodoistTask;
		return "result" in parsed ? parsed.result : parsed;
	}

	async updateTask(
		id: string,
		fields: {
			content?: string;
			description?: string;
			labels?: string[];
			priority?: number;
			projectId?: string;
			sectionId?: string;
		},
	): Promise<TodoistTask> {
		const args = ["tasks", "update", id];

		if (fields.content) {
			args.push("--title", fields.content);
		}

		if (fields.description !== undefined) {
			args.push("--description", fields.description);
		}

		if (fields.labels) {
			// CLI only supports adding one label at a time
			for (const label of fields.labels) {
				args.push("--label", label);
			}
		}

		if (fields.priority) {
			args.push("--priority", String(fields.priority));
		}

		await doist(args);
		return this.getTask(id);
	}

	async completeTask(id: string): Promise<void> {
		await doist(["tasks", "complete", "--id", id]);
	}

	async reopenTask(id: string): Promise<void> {
		await doist(["tasks", "uncomplete", "--id", id]);
	}

	async deleteTask(id: string): Promise<void> {
		await doist(["tasks", "delete", "--id", id]);
	}

	/**
	 * List tasks. Uses filter syntax supported by CLI.
	 */
	async listTasks(params?: {
		projectId?: string;
		sectionId?: string;
		filter?: string;
		labels?: string[];
		ids?: string[];
	}): Promise<TodoistTask[]> {
		const args = ["tasks", "list"];

		if (params?.filter) {
			args.push("--filter", params.filter);
		}

		if (params?.labels && params.labels.length > 0) {
			// CLI only supports one label filter at a time
			const first = params.labels[0];
			if (first) {
				args.push("--label", first);
			}
		}

		const output = await doist(args);
		return JSON.parse(output) as TodoistTask[];
	}

	// -- Comments ------------------------------------------------------------

	async addComment(taskId: string, content: string): Promise<TodoistComment> {
		const output = await doist(["tasks", "comments", "add", taskId, content]);
		return JSON.parse(output) as TodoistComment;
	}

	async listComments(taskId: string): Promise<TodoistComment[]> {
		const output = await doist(["tasks", "comments", "list", taskId]);
		return JSON.parse(output) as TodoistComment[];
	}
}

// ---------------------------------------------------------------------------
// Wayfinder label constants
// ---------------------------------------------------------------------------

export const MAP_LABEL = "wayfinder:map";
export const TICKET_LABEL = "wayfinder:ticket";
export const CLAIMED_LABEL = "wayfinder:claimed";
export const TICKET_TYPES = [
	"wayfinder:research",
	"wayfinder:prototype",
	"wayfinder:grilling",
	"wayfinder:task",
] as const;

export type TicketType = (typeof TICKET_TYPES)[number];

export const ALL_WAYFINDER_LABELS = [
	MAP_LABEL,
	TICKET_LABEL,
	CLAIMED_LABEL,
	...TICKET_TYPES,
];

/**
 * Blocking convention in task description:
 *   <!-- wayfinder:blocked-by: id1, id2 -->
 */
export function parseBlockedBy(description: string): string[] {
	const match = description.match(/<!--\s*wayfinder:blocked-by:\s*(.+?)\s*-->/);
	if (!match || match[1] === undefined) {
		return [];
	}
	return match[1]
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function setBlockedBy(description: string, blockedBy: string[]): string {
	// Remove existing annotation (including any trailing newline)
	const cleaned = description
		.replace(/<!-- wayfinder:blocked-by: .+? -->\n?/, "")
		.trimEnd();
	if (blockedBy.length === 0) {
		return cleaned;
	}
	const annotation = `<!-- wayfinder:blocked-by: ${blockedBy.join(", ")} -->`;
	return `${annotation}\n${cleaned}`.trimEnd();
}

/**
 * Map association convention in task description:
 *   <!-- wayfinder:map: <mapTaskId> -->
 *
 * Tickets carry their parent map in this tag because the doist CLI does not
 * expose a writable parentId.
 */
export function parseMapTag(description: string): string | null {
	const match = description.match(/<!--\s*wayfinder:map:\s*(\S+?)\s*-->/);
	return match?.[1] ?? null;
}

export function setMapTag(description: string, mapId: string): string {
	const cleaned = description
		.replace(/<!-- wayfinder:map: \S+ -->\n?/, "")
		.trimEnd();
	return `<!-- wayfinder:map: ${mapId} -->\n${cleaned}`.trimEnd();
}
