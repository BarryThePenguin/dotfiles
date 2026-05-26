import type { DbLabel, DbProject, DbSection, DbTask } from "./db.ts";
import {
	type ResourceType,
	type ResourceTypes,
	type UpdateFields,
	type AddFields,
	createUpdateCommand,
	createAddCommand,
	createItemCompleteCommand,
	syncRequest,
	type SyncCommand,
} from "./sdk.ts";
import {
	prepareTaskForDB,
	prepareProjectForDB,
	prepareSectionForDB,
	prepareLabelForDB,
} from "./schema.ts";

export type AllData = {
	projects: DbProject[];
	sections: DbSection[];
	labels: DbLabel[];
	tasks: DbTask[];
	completedTaskIds: string[];
	deletedTaskIds: string[];
	syncToken: string;
	tempIdMapping?: Record<string, string>;
};

/**
 * Determine resource types for a sync request based on command suggestions.
 * Always includes core types needed for the application.
 */
function getResourceTypesForSync(commands?: SyncCommand[]): ResourceTypes {
	const coreTypes: ResourceType[] = ["projects", "sections", "labels", "items"];

	if (!commands || commands.length === 0) {
		return coreTypes;
	}

	const typesSet = new Set<ResourceType>(coreTypes);
	for (const cmd of commands) {
		for (const type of cmd.suggestedResourceTypes) {
			typesSet.add(type);
		}
	}

	return Array.from(typesSet);
}

/**
 * Get the current timestamp in ISO format.
 * Used for API calls (e.g., completed_at in completeTask).
 */
function now(): string {
	return new Date().toISOString();
}

export interface TodoistClient {
	sync(syncToken?: string | null): Promise<AllData>;
	completeTask(
		id: string,
		syncToken: string | null,
	): Promise<{ syncToken: string }>;
	updateTask(
		id: string,
		fields: UpdateFields,
		syncToken: string | null,
	): Promise<{ task: DbTask; syncToken: string }>;
	addTask(
		fields: AddFields,
		syncToken: string | null,
	): Promise<{ task: DbTask; syncToken: string }>;
}

export function createClient(token: string): TodoistClient {
	async function sync(
		syncToken?: string | null,
		...commands: SyncCommand[]
	): Promise<AllData> {
		const response = await syncRequest(token, {
			sync_token: syncToken ?? "*",
			resource_types: getResourceTypesForSync(commands),
			commands,
		});

		const projects: DbProject[] = (response.projects ?? [])
			.map((p) => prepareProjectForDB(p))
			.filter((p) => p !== null);

		const sections: DbSection[] = (response.sections ?? [])
			.map((s) => prepareSectionForDB(s))
			.filter((s) => s !== null);

		const labels: DbLabel[] = (response.labels ?? [])
			.map((l) => prepareLabelForDB(l))
			.filter((l) => l !== null);

		const items = response.items ?? [];
		const tasks: DbTask[] = items
			.filter((t) => !t.is_deleted)
			.map((t) => prepareTaskForDB(t));
		const completedTaskIds = items
			.filter((t) => t.checked && !t.is_deleted)
			.map((t) => t.id);
		const deletedTaskIds = items.filter((t) => t.is_deleted).map((t) => t.id);

		// Invariant: sync_token must always be present
		if (!response.sync_token) {
			throw new Error(
				"API sync response missing sync_token (invariant violated): token and data must stay synchronized",
			);
		}

		return {
			projects,
			sections,
			labels,
			tasks,
			completedTaskIds,
			deletedTaskIds,
			syncToken: response.sync_token,
			...(response.temp_id_mapping !== undefined && {
				tempIdMapping: response.temp_id_mapping,
			}),
		};
	}

	return {
		sync: (syncToken) => sync(syncToken),

		async completeTask(id, syncToken) {
			return sync(
				syncToken,
				createItemCompleteCommand({ id, completed_at: now() }),
			);
		},

		async updateTask(id, fields, syncToken) {
			const response = await sync(syncToken, createUpdateCommand(id, fields));
			const task = response.tasks.find((t) => t.id === id);
			if (!task) {
				throw new Error(`updated task ${id} not in sync response`);
			}
			return { task, syncToken: response.syncToken };
		},

		async addTask(fields, syncToken) {
			const tempId = crypto.randomUUID();

			const {
				tasks,
				tempIdMapping,
				syncToken: newToken,
			} = await sync(syncToken, createAddCommand(fields, tempId));
			const realId = tempIdMapping?.[tempId];
			if (!realId) {
				throw new Error("failed to create task: no id returned");
			}
			const task = tasks.find((t) => t.id === realId);
			if (!task) {
				throw new Error(`created task ${realId} not in sync response`);
			}
			return { task, syncToken: newToken };
		},
	};
}
