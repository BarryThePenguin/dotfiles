import { fetch } from "undici";
import * as v from "valibot";

const TODOIST_API_BASE_URL = "https://api.todoist.com/api/v1/";

// ============================================================================
// Resource Types
// ============================================================================

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

const SyncResponseSchema = v.object({
	sync_token: v.string(),
	sync_status: v.optional(v.record(v.string(), SyncStatusValueSchema)),
	items: v.optional(v.array(ItemSchema)),
	projects: v.optional(v.array(ProjectSchema)),
	sections: v.optional(v.array(SectionSchema)),
	labels: v.optional(v.array(LabelSchema)),
	temp_id_mapping: v.optional(v.record(v.string(), v.string())),
});

const parseSyncResponse = v.parser(SyncResponseSchema);

export type SyncResponse = v.InferOutput<typeof SyncResponseSchema>;
export type SyncItem = v.InferOutput<typeof ItemSchema>;
export type SyncProject = v.InferOutput<typeof ProjectSchema>;
export type SyncSection = v.InferOutput<typeof SectionSchema>;
export type SyncLabel = v.InferOutput<typeof LabelSchema>;

// ============================================================================
// Command Argument Schemas
// ============================================================================

export const AddItemArgsSchema = v.object({
	content: v.string(),
	description: v.optional(v.string()),
	project_id: v.optional(v.string()),
	parent_id: v.optional(v.string()),
	due: v.optional(v.nullable(v.any())), // Can be null or date object
	priority: v.optional(v.number()),
	labels: v.optional(v.array(v.string())),
	section_id: v.optional(v.string()),
});
export type AddItemArgs = v.InferOutput<typeof AddItemArgsSchema>;

export const UpdateItemArgsSchema = v.object({
	id: v.string(),
	content: v.optional(v.string()),
	description: v.optional(v.string()),
	due: v.optional(v.nullable(v.any())),
	priority: v.optional(v.number()),
	labels: v.optional(v.array(v.string())),
	section_id: v.optional(v.string()),
});
export type UpdateItemArgs = v.InferOutput<typeof UpdateItemArgsSchema>;

export const MoveItemArgsSchema = v.object({
	id: v.string(),
	parent_id: v.optional(v.string()),
	section_id: v.optional(v.string()),
	project_id: v.optional(v.string()),
});
export type MoveItemArgs = v.InferOutput<typeof MoveItemArgsSchema>;

export const UncompleteItemArgsSchema = v.object({
	id: v.string(),
});
export type UncompleteItemArgs = v.InferOutput<typeof UncompleteItemArgsSchema>;

export const CompleteItemArgsSchema = v.object({
	id: v.string(),
	completed_at: v.optional(v.string()),
});
export type CompleteItemArgs = v.InferOutput<typeof CompleteItemArgsSchema>;

export const CloseItemArgsSchema = v.object({
	id: v.string(),
});
export type CloseItemArgs = v.InferOutput<typeof CloseItemArgsSchema>;

// ============================================================================
// Discriminated Union: SyncCommand
// ============================================================================

export type ItemAddCommand = {
	type: "item_add";
	uuid: string;
	args: AddItemArgs;
	temp_id?: string | undefined;
	suggestedResourceTypes: readonly ["items"];
};

export type ItemUpdateCommand = {
	type: "item_update";
	uuid: string;
	args: UpdateItemArgs;
	suggestedResourceTypes: readonly ["items"];
};

export type ItemMoveCommand = {
	type: "item_move";
	uuid: string;
	args: MoveItemArgs;
	suggestedResourceTypes: readonly ["items"];
};

export type ItemCompleteCommand = {
	type: "item_complete";
	uuid: string;
	args: CompleteItemArgs;
	suggestedResourceTypes: readonly ["items"];
};

export type ItemCloseCommand = {
	type: "item_close";
	uuid: string;
	args: CloseItemArgs;
	suggestedResourceTypes: readonly ["items"];
};

export type ItemUncompleteCommand = {
	type: "item_uncomplete";
	uuid: string;
	args: UncompleteItemArgs;
	suggestedResourceTypes: readonly ["items"];
};

export type SyncCommand =
	| ItemAddCommand
	| ItemUpdateCommand
	| ItemMoveCommand
	| ItemCompleteCommand
	| ItemCloseCommand
	| ItemUncompleteCommand;

// ============================================================================
// Command Failures & Errors
// ============================================================================

export type CommandFailure = {
	uuid: string;
	error: string;
	error_code?: number | undefined;
};

export class SyncCommandError extends Error {
	readonly failures: CommandFailure[];

	constructor(failures: CommandFailure[]) {
		super(
			`Todoist command failed: ${failures.map((f) => `${f.uuid}: ${f.error}`).join(", ")}`,
		);
		this.name = "SyncCommandError";
		this.failures = failures;
	}
}

// ============================================================================
// Command Constructors (Type-Safe)
// ============================================================================

export function createItemAddCommand(
	args: AddItemArgs,
	tempId?: string,
): ItemAddCommand {
	return {
		type: "item_add",
		uuid: crypto.randomUUID(),
		args,
		temp_id: tempId,
		suggestedResourceTypes: ["items"],
	};
}

export function createItemUpdateCommand(
	args: UpdateItemArgs,
): ItemUpdateCommand {
	return {
		type: "item_update",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["items"],
	};
}

export function createItemMoveCommand(args: MoveItemArgs): ItemMoveCommand {
	return {
		type: "item_move",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["items"],
	};
}

export function createItemCompleteCommand(
	args: CompleteItemArgs,
): ItemCompleteCommand {
	return {
		type: "item_complete",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["items"],
	};
}

export function createItemCloseCommand(args: CloseItemArgs): ItemCloseCommand {
	return {
		type: "item_close",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["items"],
	};
}

export function createItemUncompleteCommand(
	args: UncompleteItemArgs,
): ItemUncompleteCommand {
	return {
		type: "item_uncomplete",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["items"],
	};
}

// ============================================================================
// User-Facing Command Field Types
// ============================================================================

export type UpdateFields = {
	title?: string | undefined;
	projectId?: string | undefined;
	due?: string | undefined;
	priority?: number | undefined;
	labels?: string[] | undefined;
	description?: string | undefined;
	sectionId?: string | undefined;
};

export type AddFields = {
	title: string;
	projectId?: string | undefined;
	parentId?: string | undefined;
	sectionId?: string | undefined;
	description?: string | undefined;
	due?: string | undefined;
	priority?: number | undefined;
	labels?: string[] | undefined;
};

/**
 * Encode an update mutation into Todoist API request args.
 *
 * Converts user field names to API field names:
 * - title → content
 * - due → { string }
 * - sectionId → section_id
 * - priority, description, labels → as-is
 *
 * Only includes fields that are defined (undefined fields are omitted).
 * Validates and returns a type-safe UpdateItemArgs.
 */
export function encodeUpdateFields(
	fields: UpdateFields,
	id: string,
): UpdateItemArgs {
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

	return v.parse(UpdateItemArgsSchema, args);
}

/**
 * Encode an add mutation into Todoist API request args.
 *
 * Converts user field names to API field names:
 * - title → content (required)
 * - projectId → project_id
 * - sectionId → section_id
 * - due → { string }
 * - priority, labels → as-is
 *
 * Only includes fields that are defined.
 * Validates and returns a type-safe AddItemArgs.
 */
export function encodeAddFields(fields: AddFields): AddItemArgs {
	const args: Record<string, unknown> = { content: fields.title };

	if (fields.projectId !== undefined) {
		args["project_id"] = fields.projectId;
	}
	if (fields.parentId !== undefined) {
		args["parent_id"] = fields.parentId;
	}
	if (fields.sectionId !== undefined) {
		args["section_id"] = fields.sectionId;
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

	return v.parse(AddItemArgsSchema, args);
}

/**
 * Create an update command from user fields.
 * Combines encoding (user → API format) with command creation.
 */
export function createUpdateCommand(
	id: string,
	fields: UpdateFields,
): ItemUpdateCommand {
	const args = encodeUpdateFields(fields, id);
	return createItemUpdateCommand(args);
}

/**
 * Create an add command from user fields.
 * Combines encoding (user → API format) with command creation.
 */
export function createAddCommand(
	fields: AddFields,
	tempId: string,
): ItemAddCommand {
	const args = encodeAddFields(fields);
	return createItemAddCommand(args, tempId);
}

// ============================================================================
// Sync Request
// ============================================================================

/**
 * Serialize a command for the API, excluding internal fields like suggestedResourceTypes.
 */
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
