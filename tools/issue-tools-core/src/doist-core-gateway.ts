import {
	addTask,
	addTaskComment,
	completeTask as doistCoreCompleteTask,
	createContainer,
	updateTask,
	type AppTask,
	type Database,
	type TodoistClient,
} from "doist-core";
import type {
	TodoistCreateTaskInput,
	TodoistGateway,
	TodoistTask,
	TodoistTaskComment,
	TodoistUpdateTaskInput,
} from "./todoist-adapter.ts";

export type DoistCoreTodoistGatewayOptions = {
	db: Database;
	client: TodoistClient;
};

function appTaskToTodoistTask(
	task: AppTask,
	comments: TodoistTaskComment[],
): TodoistTask {
	return {
		id: task.id,
		url: task.url,
		content: task.content,
		description: task.description ?? "",
		labels: task.labels,
		parentId: task.parentId,
		projectId: task.projectId,
		isCompleted: task.isCompleted,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		comments,
	};
}

export class DoistCoreTodoistGateway implements TodoistGateway {
	readonly #db: Database;
	readonly #client: TodoistClient;
	constructor(options: DoistCoreTodoistGatewayOptions) {
		this.#db = options.db;
		this.#client = options.client;
	}

	/**
	 * Create a production gateway from environment.
	 */
	static create(): DoistCoreTodoistGateway {
		const container = createContainer();
		return new DoistCoreTodoistGateway({
			db: container.db,
			client: container.client,
		});
	}

	async createTask(input: TodoistCreateTaskInput): Promise<TodoistTask> {
		const { result } = await addTask(this.#db, this.#client, {
			title: input.content,
			description: input.description,
			labels: input.labels,
			project: input.projectId,
			parentId: input.parentId,
		});
		return this.#toTodoistTask(result);
	}

	getTask(id: string): Promise<TodoistTask> {
		const task = this.#db.getTaskById(id);
		if (!task) {
			return Promise.reject(new Error(`Todoist task not found: ${id}`));
		}
		return Promise.resolve(this.#toTodoistTask(task));
	}

	getTasks(ids: string[]): Promise<TodoistTask[]> {
		const found: TodoistTask[] = [];
		for (const id of ids) {
			const task = this.#db.getTaskById(id);
			if (!task) {
				return Promise.reject(new Error(`Todoist task not found: ${id}`));
			}
			found.push(this.#toTodoistTask(task));
		}
		return Promise.resolve(found);
	}

	async updateTask(
		id: string,
		input: TodoistUpdateTaskInput,
	): Promise<TodoistTask> {
		if (
			input.description === undefined &&
			input.addLabels === undefined &&
			input.removeLabels === undefined
		) {
			return this.getTask(id);
		}

		// One round trip, delta args only — no absolute label set is ever sent.
		// doist-core merges against the local DB task, so we don't need to
		// pre-read the current labels here.
		const { result } = await updateTask(this.#db, this.#client, id, {
			description: input.description,
			addLabels: input.addLabels,
			removeLabels: input.removeLabels,
		});
		return this.#toTodoistTask(result);
	}

	async completeTask(id: string, comment?: string): Promise<TodoistTask> {
		await doistCoreCompleteTask(this.#db, this.#client, id, comment);
		return this.getTask(id);
	}

	listTasks(input: { labels?: string[] } = {}): Promise<TodoistTask[]> {
		let tasks = this.#db
			.selectTasks({ completed: "any" })
			.map((task) => this.#toTodoistTask(task));
		if (input.labels) {
			tasks = tasks.filter((task) =>
				input.labels?.every((label) => task.labels.includes(label)),
			);
		}
		return Promise.resolve(tasks);
	}

	listSubtasks(parentId: string): Promise<TodoistTask[]> {
		return Promise.resolve(
			this.#db
				.selectTasks({ completed: "any" })
				.filter((task) => task.parentId === parentId)
				.map((task) => this.#toTodoistTask(task)),
		);
	}

	async addComment(taskId: string, body: string): Promise<void> {
		await addTaskComment(this.#db, this.#client, taskId, body);
	}

	#toTodoistTask(task: AppTask): TodoistTask {
		return appTaskToTodoistTask(
			task,
			this.#db
				.selectNotesByTask(task.id)
				.map((note) => ({ content: note.content, postedAt: note.postedAt })),
		);
	}
}
