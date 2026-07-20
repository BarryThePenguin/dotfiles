import type { DbLabel, DbProject, DbSection, DbTask } from "./db.ts";
import {
	prepareLabelForDB,
	prepareProjectForDB,
	prepareSectionForDB,
	prepareTaskForDB,
} from "./schema.ts";
import {
	fetchProjectsFromApi,
	syncRequest,
	type ResourceType,
	type ResourceTypes,
	type RestApiProject,
	type SyncCommand,
} from "./sdk.ts";

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

export interface TodoistClient {
	sync(syncToken?: string | null, ...commands: SyncCommand[]): Promise<AllData>;
	fetchProjects(
		limit?: number,
		cursor?: string | null,
	): Promise<{ projects: RestApiProject[]; nextCursor: string | null }>;
}

/**
 * Resolve a created task from a sync response using the temp ID that was sent
 * with the item_add command.
 *
 * The Todoist sync API returns a temp_id_mapping when items are created;
 * this maps each temp ID to the real server-assigned ID. Use this whenever
 * you create a task and need to return the created entity.
 */
export function resolveCreated(data: AllData, tempId: string): DbTask {
	const realId = data.tempIdMapping?.[tempId];
	if (!realId) {
		throw new Error("failed to create task: no id returned");
	}
	const task = data.tasks.find((t) => t.id === realId);
	if (!task) {
		throw new Error(`created task ${realId} not in sync response`);
	}
	return task;
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

		const projects: DbProject[] =
			response.projects
				?.map((p) => prepareProjectForDB(p))
				.filter((p): p is DbProject => p !== null) ?? [];
		const sections: DbSection[] =
			response.sections
				?.map((s) => prepareSectionForDB(s))
				.filter((s): s is DbSection => s !== null) ?? [];
		const labels: DbLabel[] =
			response.labels
				?.map((l) => prepareLabelForDB(l))
				.filter((l): l is DbLabel => l !== null) ?? [];
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
		sync: (syncToken, ...commands) => sync(syncToken, ...commands),

		fetchProjects(limit, cursor) {
			return fetchProjectsFromApi(token, limit, cursor);
		},
	};
}
