import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	TodoistCreateTaskInput,
	TodoistGateway,
	TodoistListTasksInput,
	TodoistTask,
	TodoistUpdateTaskInput,
} from "./todoist-tracker.ts";

const exec = promisify(execFile);

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

export type CliComment = {
	content: string;
};

type CliResult<T> = {
	ok: boolean;
	result: T;
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
	const parsed = parseJson(output) as CliResult<CliTask> | CliTask;
	return "result" in parsed ? parsed.result : parsed;
}

export function unwrapComments(output: string): CliComment[] {
	const parsed = parseJson(output) as CliResult<CliComment[]> | CliComment[];
	return Array.isArray(parsed) ? parsed : parsed.result;
}

export type DoistCliGatewayOptions = {
	command?: string;
};

export class DoistCliGateway implements TodoistGateway {
	readonly #command: string;

	constructor(options: DoistCliGatewayOptions = {}) {
		this.#command = options.command ?? "doist";
	}

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

		return toTodoistTask(unwrapTask(await this.#doist(args)));
	}

	async getTask(id: string): Promise<TodoistTask> {
		const [task, comments] = await Promise.all([
			this.#doist(["tasks", "get", id]),
			this.#listComments(id),
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

		await this.#doist(args);
		return this.getTask(id);
	}

	async completeTask(id: string): Promise<TodoistTask> {
		await this.#doist(["tasks", "complete", "--id", id]);
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
		const tasks = (parseJson(await this.#doist(args)) as CliTask[]).map((task) =>
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
		await this.#doist(["tasks", "comments", "add", taskId, body]);
	}

	async #listComments(taskId: string): Promise<string[]> {
		const comments = unwrapComments(
			await this.#doist(["tasks", "comments", "list", taskId]),
		);
		return comments.map((comment) => comment.content);
	}

	async #doist(args: string[]): Promise<string> {
		const { stdout, stderr } = await exec(this.#command, args);
		if (stderr) {
			console.error("doist stderr:", stderr);
		}
		return stdout.trim();
	}
}
