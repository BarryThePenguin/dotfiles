import {
	addTask,
	completeTasks,
	createNoteAddCommand,
	getToken,
	persistMutations,
	updateTask,
	type AppTask,
	type Database,
	type TodoistClient,
} from "doist-core";
import type {
	TodoistCreateTaskInput,
	TodoistGateway,
	TodoistTask,
	TodoistUpdateTaskInput,
} from "./todoist-tracker.ts";

export type DoistCoreTodoistGatewayOptions = {
	db: Database;
	client: TodoistClient;
};

function appTaskToTodoistTask(task: AppTask, comments: string[]): TodoistTask {
	return {
		id: task.id,
		url: task.url,
		content: task.content,
		description: task.description ?? "",
		labels: task.labels,
		parentId: task.parentId,
		projectId: task.projectId,
		isCompleted: task.isCompleted,
		comments,
	};
}

export class DoistCoreTodoistGateway implements TodoistGateway {
	readonly #db: Database;
	readonly #client: TodoistClient;
	readonly #postedComments = new Map<string, string[]>();

	constructor(options: DoistCoreTodoistGatewayOptions) {
		this.#db = options.db;
		this.#client = options.client;
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

	async updateTask(
		id: string,
		input: TodoistUpdateTaskInput,
	): Promise<TodoistTask> {
		if (input.description === undefined && input.labels === undefined) {
			return this.getTask(id);
		}

		const { result } = await updateTask(this.#db, this.#client, id, {
			description: input.description,
			...(input.labels !== undefined
				? { addLabels: [], removeLabels: [] }
				: {}),
		});

		if (input.labels === undefined) {
			return this.#toTodoistTask(result);
		}

		const { result: labelUpdated } = await updateTask(
			this.#db,
			this.#client,
			id,
			{
				removeLabels: result.labels.filter(
					(label) => !input.labels?.includes(label),
				),
				addLabels: input.labels.filter(
					(label) => !result.labels.includes(label),
				),
			},
		);
		return this.#toTodoistTask(labelUpdated);
	}

	async completeTask(id: string): Promise<TodoistTask> {
		await completeTasks(this.#db, this.#client, [id]);
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
		const allData = await this.#client.sync(
			getToken(this.#db),
			createNoteAddCommand({ item_id: taskId, content: body }),
		);
		persistMutations(this.#db, { token: allData.syncToken });

		const existing = this.#postedComments.get(taskId) ?? [];
		this.#postedComments.set(taskId, [...existing, body]);
	}

	#toTodoistTask(task: AppTask): TodoistTask {
		return appTaskToTodoistTask(task, this.#postedComments.get(task.id) ?? []);
	}
}
