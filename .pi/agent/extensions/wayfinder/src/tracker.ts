/**
 * Wayfinder tracker factory for the Pi extension.
 *
 * The extension speaks the domain-level WayfinderTracker interface. Storage is
 * selected here: local Markdown by default when Todoist is not configured, or
 * Todoist via the `doist` CLI when Todoist config is present.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	LocalMarkdownTracker,
	TodoistTracker,
	type TodoistCreateTaskInput,
	type TodoistGateway,
	type TodoistListTasksInput,
	type TodoistTask,
	type TodoistUpdateTaskInput,
	type WayfinderTracker,
} from "wayfinder-core";

const exec = promisify(execFile);

export type TrackerMode = "local" | "todoist";

export type CreateWayfinderTrackerOptions = {
	cwd: string;
	mode?: TrackerMode;
};

export type TrackerSelection =
	| {
			mode: TrackerMode;
			source:
				"env" | "existing-local" | "existing-doist" | "session-preference";
			path?: string;
	  }
	| {
			mode: null;
			source: "needs-preference";
	  };

export const MAP_LABEL = "wayfinder_map";
export const TICKET_LABEL = "wayfinder_ticket";
export const CLAIMED_LABEL = "wayfinder_claimed";
export const TICKET_TYPES = [
	"wayfinder_research",
	"wayfinder_prototype",
	"wayfinder_grilling",
	"wayfinder_task",
] as const;

export type TicketType = (typeof TICKET_TYPES)[number];

export const ALL_WAYFINDER_LABELS = [
	MAP_LABEL,
	TICKET_LABEL,
	CLAIMED_LABEL,
	...TICKET_TYPES,
];

function pathIsDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function pathIsFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function explicitTrackerMode(): TrackerMode | null {
	const mode = process.env["WAYFINDER_TRACKER"]?.toLowerCase();
	return mode === "local" || mode === "todoist" ? mode : null;
}

export function localTrackerRoot(cwd: string): string {
	return resolve(cwd, process.env["WAYFINDER_ROOT"] ?? ".wayfinder");
}

export function findDoistRc(start: string): string | null {
	let current = resolve(start);
	for (;;) {
		const candidate = join(current, ".doistrc");
		if (pathIsFile(candidate)) {
			return candidate;
		}
		if (existsSync(join(current, ".git"))) {
			return null;
		}
		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

export function detectTrackerSelection(cwd: string): TrackerSelection {
	const explicitMode = explicitTrackerMode();
	if (explicitMode) {
		return { mode: explicitMode, source: "env" };
	}

	const localRoot = localTrackerRoot(cwd);
	if (pathIsDirectory(localRoot)) {
		return { mode: "local", source: "existing-local", path: localRoot };
	}

	const doistRc = findDoistRc(cwd);
	if (doistRc) {
		return { mode: "todoist", source: "existing-doist", path: doistRc };
	}

	return { mode: null, source: "needs-preference" };
}

export function selectedTrackerMode(cwd?: string): TrackerMode {
	if (cwd) {
		const selection = detectTrackerSelection(cwd);
		return selection.mode ?? "local";
	}
	return explicitTrackerMode() ?? "local";
}

async function doist(args: string[]): Promise<string> {
	const { stdout, stderr } = await exec("doist", args);
	if (stderr) {
		console.error("doist stderr:", stderr);
	}
	return stdout.trim();
}

type CliTask = {
	id: string;
	url?: string;
	content: string;
	description?: string;
	labels?: string[];
	parentId?: string | null;
	parent_id?: string | null;
	projectId?: string | null;
	project_id?: string | null;
	checked?: boolean;
	isCompleted?: boolean;
	is_completed?: boolean;
};

type CliComment = {
	content: string;
};

function toTodoistTask(task: CliTask, comments: string[] = []): TodoistTask {
	return {
		id: task.id,
		url: task.url ?? `https://app.todoist.com/app/task/${task.id}`,
		content: task.content,
		description: task.description ?? "",
		labels: task.labels ?? [],
		parentId: task.parentId ?? task.parent_id ?? null,
		projectId: task.projectId ?? task.project_id ?? null,
		isCompleted: task.isCompleted ?? task.is_completed ?? task.checked ?? false,
		comments,
	};
}

function parseJson(output: string): unknown {
	return JSON.parse(output) as unknown;
}

function unwrapTask(output: string): CliTask {
	const parsed = parseJson(output) as
		{ ok: boolean; result: CliTask } | CliTask;
	return "result" in parsed ? parsed.result : parsed;
}

class DoistCliGateway implements TodoistGateway {
	async createTask(input: TodoistCreateTaskInput): Promise<TodoistTask> {
		const args = ["tasks", "add", "--title", input.content];

		if (input.description) {
			args.push("--description", input.description);
		}
		if (input.projectId) {
			args.push("--project", input.projectId);
		}
		if (input.parentId) {
			args.push("--parent", input.parentId);
		}
		if (input.labels.length > 0) {
			args.push("--label", input.labels.join(","));
		}

		return toTodoistTask(unwrapTask(await doist(args)));
	}

	async getTask(id: string): Promise<TodoistTask> {
		const [task, comments] = await Promise.all([
			doist(["tasks", "get", id]),
			this.listComments(id),
		]);
		return toTodoistTask(unwrapTask(task), comments);
	}

	async updateTask(
		id: string,
		input: TodoistUpdateTaskInput,
	): Promise<TodoistTask> {
		const args = ["tasks", "update", id];

		if (input.description !== undefined) {
			args.push("--description", input.description);
		}
		if (input.labels) {
			for (const label of input.labels) {
				args.push("--label", label);
			}
		}

		await doist(args);
		return this.getTask(id);
	}

	async completeTask(id: string): Promise<TodoistTask> {
		await doist(["tasks", "complete", "--id", id]);
		return this.getTask(id);
	}

	async listTasks(input: TodoistListTasksInput = {}): Promise<TodoistTask[]> {
		const args = ["tasks", "list"];
		if (input.labels && input.labels.length > 0) {
			const [firstLabel] = input.labels;
			if (firstLabel) {
				args.push("--label", firstLabel);
			}
		}
		const tasks = (parseJson(await doist(args)) as CliTask[]).map((task) =>
			toTodoistTask(task),
		);
		return input.labels
			? tasks.filter((task) =>
					input.labels?.every((label) => task.labels.includes(label)),
				)
			: tasks;
	}

	async listSubtasks(parentId: string): Promise<TodoistTask[]> {
		return (await this.listTasks()).filter(
			(task) => task.parentId === parentId,
		);
	}

	async addComment(taskId: string, body: string): Promise<void> {
		await doist(["tasks", "comments", "add", taskId, body]);
	}

	private async listComments(taskId: string): Promise<string[]> {
		const comments = parseJson(
			await doist(["tasks", "comments", "list", taskId]),
		) as CliComment[];
		return comments.map((comment) => comment.content);
	}
}

export function createWayfinderTracker({
	cwd,
	mode = selectedTrackerMode(cwd),
}: CreateWayfinderTrackerOptions): WayfinderTracker {
	if (mode === "local") {
		return new LocalMarkdownTracker(localTrackerRoot(cwd));
	}
	return new TodoistTracker(new DoistCliGateway(), {
		...(process.env["WAYFINDER_TODOIST_PROJECT_ID"]
			? { projectId: process.env["WAYFINDER_TODOIST_PROJECT_ID"] }
			: {}),
	});
}

/**
 * Blocking convention in task description:
 *   <!-- wayfinder:blocked-by: id1, id2 -->
 */
export function parseBlockedBy(description: string): string[] {
	const match = description.match(
		/<!--\s*wayfinder:blocked-by:?\s*(.+?)\s*-->/,
	);
	if (!match || match[1] === undefined) {
		return [];
	}
	return match[1]
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

export function setBlockedBy(description: string, blockedBy: string[]): string {
	const cleaned = description
		.replace(/<!-- wayfinder:blocked-by:? .+? -->\n?/, "")
		.trimEnd();
	if (blockedBy.length === 0) {
		return cleaned;
	}
	const annotation = `<!-- wayfinder:blocked-by: ${blockedBy.join(", ")} -->`;
	return `${annotation}\n${cleaned}`.trimEnd();
}

export function parseMapTag(description: string): string | null {
	const match = description.match(/<!--\s*wayfinder:map:?\s*(\S+?)\s*-->/);
	return match?.[1] ?? null;
}

export function setMapTag(description: string, mapId: string): string {
	const cleaned = description
		.replace(/<!-- wayfinder:map:? \S+ -->\n?/, "")
		.trimEnd();
	return `<!-- wayfinder:map: ${mapId} -->\n${cleaned}`.trimEnd();
}
