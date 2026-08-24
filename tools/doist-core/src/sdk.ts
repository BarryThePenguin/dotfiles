import { fetch } from "undici";
import * as v from "valibot";
import {
	SyncCommandError,
	type CommandFailure,
	type SyncCommand,
} from "./sync-commands.ts";

const TODOIST_API_BASE_URL = "https://api.todoist.com/api/v1/";

export type ResourceType =
	| "all"
	| "labels"
	| "projects"
	| "items"
	| "notes"
	| "sections"
	| "filters"
	| "reminders"
	| "reminders_location"
	| "locations"
	| "user"
	| "live_notifications"
	| "collaborators"
	| "user_settings"
	| "notification_settings"
	| "user_plan_limits"
	| "completed_info"
	| "stats"
	| "workspaces"
	| "workspace_users"
	| "workspace_filters"
	| "view_options"
	| "project_view_options_defaults"
	| "role_actions";

export type ResourceTypes = (ResourceType | `-${ResourceType}`)[];

// ============================================================================
// Sync Response Schemas
// ============================================================================

const DueSchema = v.nullable(
	v.object({
		date: v.string(),
		string: v.string(),
		is_recurring: v.optional(v.boolean()),
	}),
);

const ItemSchema = v.object({
	id: v.string(),
	project_id: v.string(),
	section_id: v.nullable(v.string()),
	content: v.string(),
	description: v.string(),
	priority: v.number(),
	due: DueSchema,
	labels: v.array(v.string()),
	checked: v.optional(v.boolean()),
	added_at: v.optional(v.nullable(v.string())),
	updated_at: v.optional(v.nullable(v.string())),
	parent_id: v.optional(v.nullable(v.string())),
	child_order: v.optional(v.number()),
	note_count: v.optional(v.number()),
	is_deleted: v.boolean(),
});

const ProjectSchema = v.object({
	id: v.string(),
	name: v.string(),
	color: v.optional(v.nullable(v.string())),
	is_favorite: v.optional(v.boolean()),
	inbox_project: v.optional(v.boolean()),
	is_deleted: v.boolean(),
	is_archived: v.boolean(),
});

const SectionSchema = v.object({
	id: v.string(),
	project_id: v.string(),
	name: v.string(),
	section_order: v.optional(v.number(), 0),
	is_deleted: v.boolean(),
	is_archived: v.optional(v.boolean()),
});

const LabelSchema = v.object({
	id: v.string(),
	name: v.string(),
	color: v.optional(v.nullable(v.string())),
	is_deleted: v.boolean(),
});

const SyncStatusValueSchema = v.union([
	v.literal("ok"),
	v.object({ error: v.string(), error_code: v.optional(v.number()) }),
]);

const FilterSchema = v.object({
	id: v.string(),
	name: v.string(),
	query: v.string(),
	color: v.optional(v.nullable(v.string())),
	item_order: v.optional(v.number()),
	is_deleted: v.boolean(),
	is_favorite: v.optional(v.boolean(), false),
	is_frozen: v.optional(v.boolean(), false),
});

const NoteSchema = v.object({
	id: v.string(),
	item_id: v.string(),
	content: v.string(),
	posted_at: v.optional(v.nullable(v.string())),
	is_deleted: v.boolean(),
});

const SyncResponseSchema = v.object({
	sync_token: v.string(),
	sync_status: v.optional(v.record(v.string(), SyncStatusValueSchema)),
	items: v.optional(v.array(ItemSchema)),
	projects: v.optional(v.array(ProjectSchema)),
	sections: v.optional(v.array(SectionSchema)),
	labels: v.optional(v.array(LabelSchema)),
	filters: v.optional(v.array(FilterSchema)),
	notes: v.optional(v.array(NoteSchema)),
	temp_id_mapping: v.optional(v.record(v.string(), v.string())),
});

const parseSyncResponse = v.parser(SyncResponseSchema);

export type SyncResponse = v.InferOutput<typeof SyncResponseSchema>;
export type SyncItem = v.InferOutput<typeof ItemSchema>;
export type SyncProject = v.InferOutput<typeof ProjectSchema>;
export type SyncSection = v.InferOutput<typeof SectionSchema>;
export type SyncLabel = v.InferOutput<typeof LabelSchema>;
export type SyncFilter = v.InferOutput<typeof FilterSchema>;
export type SyncNote = v.InferOutput<typeof NoteSchema>;

// ============================================================================
// Sync Request
// ============================================================================

function serializeCommand(cmd: SyncCommand): Record<string, unknown> {
	const { type, uuid, args } = cmd;
	const serialized: Record<string, unknown> = {
		type,
		uuid,
		args,
	};
	if ("temp_id" in cmd && cmd.temp_id !== undefined) {
		serialized["temp_id"] = cmd.temp_id;
	}
	return serialized;
}

/**
 * Execute a sync request with optional commands and explicit resource types.
 *
 * @param token - Todoist API token
 * @param params - Sync parameters
 * @param params.sync_token - Sync token (use "*" for full sync)
 * @param params.resource_types - Explicit resource types to fetch. The caller controls this;
 *                                commands' suggestedResourceTypes are only used for reference.
 * @param params.commands - Optional commands to execute in this sync
 */
export async function syncRequest(
	token: string,
	params: {
		sync_token: string;
		resource_types: ResourceTypes;
		commands?: SyncCommand[];
	},
): Promise<SyncResponse> {
	const url = new URL("sync", TODOIST_API_BASE_URL);
	const requestParams: Record<string, string> = {
		sync_token: params.sync_token,
		resource_types: JSON.stringify(params.resource_types),
	};

	if (params.commands && params.commands.length > 0) {
		const apiCommands = params.commands.map(serializeCommand);
		requestParams["commands"] = JSON.stringify(apiCommands);
	}

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams(requestParams),
	});

	if (!res.ok) {
		throw new Error(`Todoist sync failed: ${res.status} ${res.statusText}`);
	}

	const data = parseSyncResponse(await res.json());

	const failures: CommandFailure[] = [];
	for (const [uuid, s] of Object.entries(data.sync_status ?? {})) {
		if (s !== "ok") {
			failures.push({ uuid, ...s });
		}
	}
	if (failures.length > 0) {
		throw new SyncCommandError(failures);
	}

	return data;
}

// ============================================================================
// REST API - Projects Discovery
// ============================================================================

export const RestApiProjectSchema = v.object({
	id: v.string(),
	name: v.string(),
	color: v.optional(v.nullable(v.string())),
	is_favorite: v.optional(v.boolean(), false),
	inbox_project: v.optional(v.boolean(), false),
	is_archived: v.optional(v.boolean(), false),
	is_deleted: v.optional(v.boolean(), false),
});

const RestApiProjectsResponseSchema = v.object({
	results: v.array(RestApiProjectSchema),
	next_cursor: v.optional(v.nullable(v.string())),
});

const parseProjectsResponse = v.parser(RestApiProjectsResponseSchema);

export type RestApiProject = v.InferOutput<typeof RestApiProjectSchema>;

/**
 * Fetch a page of projects from the Todoist REST API.
 * Callers can use the returned next_cursor to fetch subsequent pages.
 */
export async function fetchProjectsFromApi(
	token: string,
	limit: number = 200,
	cursor?: string | null,
): Promise<{ projects: RestApiProject[]; nextCursor: string | null }> {
	const url = new URL("projects", TODOIST_API_BASE_URL);

	url.searchParams.set("limit", limit.toString());

	if (cursor) {
		url.searchParams.set("cursor", cursor);
	}

	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!res.ok) {
		throw new Error(`Todoist API failed: ${res.status} ${res.statusText}`);
	}

	const data = parseProjectsResponse(await res.json());
	return {
		projects: data.results,
		nextCursor: data.next_cursor ?? null,
	};
}

// ============================================================================
// REST API - Tasks by Filter
// ============================================================================

const TaskByFilterSchema = v.object({
	id: v.string(),
	content: v.string(),
	description: v.string(),
	priority: v.number(),
	due: DueSchema,
	labels: v.array(v.string()),
	checked: v.optional(v.boolean()),
	added_at: v.optional(v.nullable(v.string())),
	updated_at: v.optional(v.nullable(v.string())),
	parent_id: v.optional(v.nullable(v.string())),
	child_order: v.optional(v.nullable(v.number())),
	note_count: v.optional(v.nullable(v.number())),
	project_id: v.nullable(v.string()),
	section_id: v.nullable(v.string()),
	is_deleted: v.boolean(),
});

const TasksByFilterResponseSchema = v.object({
	results: v.array(TaskByFilterSchema),
	next_cursor: v.optional(v.nullable(v.string())),
});

export type RestApiTaskByFilter = v.InferOutput<typeof TaskByFilterSchema>;

/**
 * Fetch tasks matching a filter query string via the Todoist REST API.
 *
 * Executes a filter query (e.g. "today", "overdue & #Work", "priority 1")
 * on Todoist's servers and returns the matching tasks.
 *
 * @param token - Todoist API token
 * @param query - Filter query string (Todoist filter syntax)
 * @param limit - Max tasks to return (1-200, default 50)
 * @param cursor - Pagination cursor
 * @returns Matching tasks and optional next cursor
 */
export async function fetchTasksByFilter(
	token: string,
	query: string,
	limit: number = 50,
	cursor?: string | null,
): Promise<{ tasks: RestApiTaskByFilter[]; nextCursor: string | null }> {
	const url = new URL("tasks/filter", TODOIST_API_BASE_URL);

	url.searchParams.set("query", query);
	url.searchParams.set("limit", limit.toString());

	if (cursor) {
		url.searchParams.set("cursor", cursor);
	}

	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (!res.ok) {
		throw new Error(
			`Todoist filter query failed: ${res.status} ${res.statusText}`,
		);
	}

	const data = v.parse(TasksByFilterResponseSchema, await res.json());
	return {
		tasks: data.results,
		nextCursor: data.next_cursor ?? null,
	};
}

// ============================================================================
// REST API - Single Task
// ============================================================================

const RestApiTaskSchema = v.object({
	id: v.string(),
	content: v.string(),
	description: v.string(),
	priority: v.number(),
	due: DueSchema,
	labels: v.array(v.string()),
	checked: v.boolean(),
	completed_at: v.optional(v.nullable(v.string())),
	added_at: v.optional(v.nullable(v.string())),
	updated_at: v.optional(v.nullable(v.string())),
	parent_id: v.optional(v.nullable(v.string())),
	project_id: v.nullable(v.string()),
	section_id: v.optional(v.nullable(v.string())),
	child_order: v.optional(v.nullable(v.number())),
	note_count: v.optional(v.nullable(v.number())),
});

export type RestApiTask = v.InferOutput<typeof RestApiTaskSchema>;

/**
 * Fetch a single task by id from the Todoist REST API.
 *
 * Used to resolve tasks the local sync database has never seen. A full sync
 * never returns closed tasks at all — only tasks that are currently open, or
 * that were open and then closed while already tracked locally. A task
 * closed before this machine ever synced it will never arrive through sync,
 * on any future sync, no matter how many times it runs.
 *
 * @returns the task, or null when the API reports 404 (genuinely unknown/deleted).
 */
export async function fetchTaskFromApi(
	token: string,
	id: string,
): Promise<RestApiTask | null> {
	const url = new URL(`tasks/${id}`, TODOIST_API_BASE_URL);

	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});

	if (res.status === 404) {
		return null;
	}

	if (!res.ok) {
		throw new Error(`Todoist API failed: ${res.status} ${res.statusText}`);
	}

	return v.parse(RestApiTaskSchema, await res.json());
}
