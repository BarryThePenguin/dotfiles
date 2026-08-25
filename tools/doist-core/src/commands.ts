import * as v from "valibot";

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
// Filter Command Argument Schemas
// ============================================================================

export const AddFilterArgsSchema = v.object({
	name: v.string(),
	query: v.string(),
	color: v.optional(v.nullable(v.string())),
	item_order: v.optional(v.number()),
	is_favorite: v.optional(v.boolean()),
});
export type AddFilterArgs = v.InferOutput<typeof AddFilterArgsSchema>;

export const UpdateFilterArgsSchema = v.object({
	id: v.string(),
	name: v.optional(v.string()),
	query: v.optional(v.string()),
	color: v.optional(v.nullable(v.string())),
	item_order: v.optional(v.number()),
	is_favorite: v.optional(v.boolean()),
});
export type UpdateFilterArgs = v.InferOutput<typeof UpdateFilterArgsSchema>;

export const DeleteFilterArgsSchema = v.object({
	id: v.string(),
});
export type DeleteFilterArgs = v.InferOutput<typeof DeleteFilterArgsSchema>;

export const UpdateFilterOrdersArgsSchema = v.object({
	id_order_mapping: v.record(v.string(), v.number()),
});
export type UpdateFilterOrdersArgs = v.InferOutput<
	typeof UpdateFilterOrdersArgsSchema
>;

// ============================================================================
// Note Command Argument Schemas
// ============================================================================

export const AddNoteArgsSchema = v.object({
	item_id: v.string(),
	content: v.string(),
});
export type AddNoteArgs = v.InferOutput<typeof AddNoteArgsSchema>;

export const UpdateNoteArgsSchema = v.object({
	id: v.string(),
	content: v.optional(v.string()),
});
export type UpdateNoteArgs = v.InferOutput<typeof UpdateNoteArgsSchema>;

export const DeleteNoteArgsSchema = v.object({
	id: v.string(),
});
export type DeleteNoteArgs = v.InferOutput<typeof DeleteNoteArgsSchema>;

// ============================================================================
// Discriminated Union: Command
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

export type FilterAddCommand = {
	type: "filter_add";
	uuid: string;
	args: AddFilterArgs;
	temp_id?: string | undefined;
	suggestedResourceTypes: readonly ["filters"];
};

export type FilterUpdateCommand = {
	type: "filter_update";
	uuid: string;
	args: UpdateFilterArgs;
	suggestedResourceTypes: readonly ["filters"];
};

export type FilterDeleteCommand = {
	type: "filter_delete";
	uuid: string;
	args: DeleteFilterArgs;
	suggestedResourceTypes: readonly ["filters"];
};

export type FilterUpdateOrdersCommand = {
	type: "filter_update_orders";
	uuid: string;
	args: UpdateFilterOrdersArgs;
	suggestedResourceTypes: readonly ["filters"];
};

export type NoteAddCommand = {
	type: "note_add";
	uuid: string;
	args: AddNoteArgs;
	temp_id?: string | undefined;
	suggestedResourceTypes: readonly ["notes"];
};

export type NoteUpdateCommand = {
	type: "note_update";
	uuid: string;
	args: UpdateNoteArgs;
	suggestedResourceTypes: readonly ["notes"];
};

export type NoteDeleteCommand = {
	type: "note_delete";
	uuid: string;
	args: DeleteNoteArgs;
	suggestedResourceTypes: readonly ["notes"];
};

export type Command =
	| ItemAddCommand
	| ItemUpdateCommand
	| ItemMoveCommand
	| ItemCompleteCommand
	| ItemCloseCommand
	| ItemUncompleteCommand
	| FilterAddCommand
	| FilterUpdateCommand
	| FilterDeleteCommand
	| FilterUpdateOrdersCommand
	| NoteAddCommand
	| NoteUpdateCommand
	| NoteDeleteCommand;

// ============================================================================
// Command Failures & Errors
// ============================================================================

export type CommandFailure = {
	uuid: string;
	error: string;
	error_code?: number | undefined;
};

export class CommandError extends Error {
	readonly failures: CommandFailure[];

	constructor(failures: CommandFailure[]) {
		super(
			`Todoist command failed: ${failures.map((f) => `${f.uuid}: ${f.error}`).join(", ")}`,
		);
		this.name = "CommandError";
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
// Filter Command Constructors
// ============================================================================

export function createFilterAddCommand(
	args: AddFilterArgs,
	tempId?: string,
): FilterAddCommand {
	return {
		type: "filter_add",
		uuid: crypto.randomUUID(),
		args,
		temp_id: tempId,
		suggestedResourceTypes: ["filters"],
	};
}

export function createFilterUpdateCommand(
	args: UpdateFilterArgs,
): FilterUpdateCommand {
	return {
		type: "filter_update",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["filters"],
	};
}

export function createFilterDeleteCommand(
	args: DeleteFilterArgs,
): FilterDeleteCommand {
	return {
		type: "filter_delete",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["filters"],
	};
}

// ============================================================================
// Note Command Constructors
// ============================================================================

export function createNoteAddCommand(
	args: AddNoteArgs,
	tempId?: string,
): NoteAddCommand {
	return {
		type: "note_add",
		uuid: crypto.randomUUID(),
		args,
		temp_id: tempId,
		suggestedResourceTypes: ["notes"],
	};
}

export function createNoteUpdateCommand(
	args: UpdateNoteArgs,
): NoteUpdateCommand {
	return {
		type: "note_update",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["notes"],
	};
}

export function createNoteDeleteCommand(
	args: DeleteNoteArgs,
): NoteDeleteCommand {
	return {
		type: "note_delete",
		uuid: crypto.randomUUID(),
		args,
		suggestedResourceTypes: ["notes"],
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
