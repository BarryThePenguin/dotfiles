import type { DbLabel, DbProject, DbSection, DbTask } from "./db.ts";
import type { SyncItem } from "./sdk.ts";
import { createCommand, syncRequest, type SyncCommand } from "./sdk.ts";

export type UpdateFields = {
	title?: string | undefined;
	due?: string | undefined;
	priority?: number | undefined;
	labels?: string[] | undefined;
	description?: string | undefined;
	sectionId?: string | undefined;
};

export type AddFields = {
	title: string;
	projectId?: string | undefined;
	sectionId?: string | undefined;
	due?: string | undefined;
	priority?: number | undefined;
	labels?: string[] | undefined;
};

export type AllData = {
	projects: DbProject[];
	sections: DbSection[];
	labels: DbLabel[];
	tasks: DbTask[];
	deletedTaskIds: string[];
	syncToken: string | null;
	tempIdMapping?: Record<string, string>;
};

function now(): string {
	return new Date().toISOString();
}

function taskToDb(t: SyncItem, syncedAt = now()): DbTask {
	return {
		id: t.id,
		project_id: t.projectId,
		section_id: t.sectionId,
		content: t.content,
		description: t.description,
		priority: t.priority,
		due_date: t.due?.date ?? null,
		due_string: t.due?.string ?? null,
		labels: JSON.stringify(t.labels),
		is_completed: t.completed ? 1 : 0,
		created_at: t.addedAt?.toISOString() ?? null,
		synced_at: syncedAt,
	};
}

export interface TodoistClient {
	sync(syncToken?: string | null): Promise<AllData>;
	completeTask(
		id: string,
		syncToken: string | null,
	): Promise<{ syncToken: string | null }>;
	updateTask(
		id: string,
		fields: UpdateFields,
		syncToken: string | null,
	): Promise<{ task: DbTask; syncToken: string | null }>;
	addTask(
		fields: AddFields,
		syncToken: string | null,
	): Promise<{ task: DbTask; syncToken: string | null }>;
}

const resourceTypes = JSON.stringify([
	"projects",
	"sections",
	"labels",
	"items",
]);

export function createClient(token: string): TodoistClient {
	async function sync(
		syncToken?: string | null,
		commands: SyncCommand[] = [],
	): Promise<AllData> {
		const syncedAt = now();
		const params: Record<string, string> = {
			sync_token: syncToken ?? "*",
			resource_types: resourceTypes,
		};
		if (commands.length > 0) {
			params["commands"] = JSON.stringify(commands);
		}
		const response = await syncRequest(token, params);

		const projects: DbProject[] = (response.projects ?? [])
			.filter((p) => !p.isDeleted && !p.isArchived)
			.map((p) => ({
				id: p.id,
				name: p.name,
				color: p.color,
				is_favorite: p.isFavorite ? 1 : 0,
				is_inbox: p.inboxProject ? 1 : 0,
				synced_at: syncedAt,
			}));

		const sections: DbSection[] = (response.sections ?? [])
			.filter((s) => !s.isDeleted && !s.isArchived)
			.map((s) => ({
				id: s.id,
				project_id: s.projectId,
				name: s.name,
				order_: s.sectionOrder,
				synced_at: syncedAt,
			}));

		const labels: DbLabel[] = (response.labels ?? [])
			.filter((l) => !l.isDeleted)
			.map((l) => ({
				id: l.id,
				name: l.name,
				color: l.color,
				synced_at: syncedAt,
			}));

		const items = response.items ?? [];
		const tasks: DbTask[] = items
			.filter((t) => !t.isDeleted)
			.map((t) => taskToDb(t, syncedAt));
		const deletedTaskIds = items.filter((t) => t.isDeleted).map((t) => t.id);

		return {
			projects,
			sections,
			labels,
			tasks,
			deletedTaskIds,
			syncToken: response.syncToken,
			...(response.tempIdMapping !== undefined && {
				tempIdMapping: response.tempIdMapping,
			}),
		};
	}

	return {
		sync: (syncToken) => sync(syncToken),

		async completeTask(id, syncToken) {
			const { syncToken: newToken } = await sync(syncToken, [
				createCommand("item_complete", { id, completed_at: now() }),
			]);
			return { syncToken: newToken };
		},

		async updateTask(id, fields, syncToken) {
			const args: Record<string, unknown> = { id };
			if (fields.title !== undefined) {
				args["content"] = fields.title;
			}
			if (fields.description !== undefined) {
				args["description"] = fields.description;
			}
			if (fields.priority !== undefined) {
				args["priority"] = fields.priority;
			}
			if (fields.due !== undefined) {
				args["due"] = { string: fields.due };
			}
			if (fields.labels !== undefined) {
				args["labels"] = fields.labels;
			}
			if (fields.sectionId !== undefined) {
				args["section_id"] = fields.sectionId;
			}

			const { tasks, syncToken: newToken } = await sync(syncToken, [
				createCommand("item_update", args),
			]);
			const task = tasks.find((t) => t.id === id);
			if (!task) {
				throw new Error(`task ${id} not found after update`);
			}
			return { task, syncToken: newToken };
		},

		async addTask(fields, syncToken) {
			const tempId = crypto.randomUUID();
			const args: Record<string, unknown> = { content: fields.title };
			if (fields.projectId !== undefined) {
				args["project_id"] = fields.projectId;
			}
			if (fields.sectionId !== undefined) {
				args["section_id"] = fields.sectionId;
			}
			if (fields.priority !== undefined) {
				args["priority"] = fields.priority;
			}
			if (fields.due !== undefined) {
				args["due"] = { string: fields.due };
			}
			if (fields.labels !== undefined) {
				args["labels"] = fields.labels;
			}

			const { tasks, tempIdMapping, syncToken: newToken } = await sync(syncToken, [
				createCommand("item_add", args, tempId),
			]);
			const realId = tempIdMapping?.[tempId];
			if (!realId) {
				throw new Error("failed to create task: no id returned");
			}
			const task = tasks.find((t) => t.id === realId);
			if (!task) {
				throw new Error(`task ${realId} not found after creation`);
			}
			return { task, syncToken: newToken };
		},
	};
}
