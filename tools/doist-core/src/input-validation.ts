/**
 * Centralized validation schemas for Doist operations.
 *
 * This module owns all input validation for task operations, ensuring a single
 * source of truth for what fields can be set and what values are valid.
 *
 * Every user-supplied string field is capped at its Todoist API limit via the
 * `LIMITS` constant. See `./limits.ts` for the source-of-truth character caps.
 */

import * as v from "valibot";
import { defineCliFields } from "./cli-fields.ts";
import { LIMITS } from "./limits.ts";

// ── Reusable string-shape building blocks ─────────────────────────────────
//
// Each `*Schema` is a `v.pipe(v.string(), v.maxLength(LIMITS.x))` and is
// composed into the per-operation field schemas below.

const TaskContentSchema = v.pipe(v.string(), v.maxLength(LIMITS.taskName));
const TaskDescriptionSchema = v.pipe(
	v.string(),
	v.maxLength(LIMITS.taskDescription),
);
const DueStringSchema = v.pipe(v.string(), v.maxLength(LIMITS.date));
const LabelNameSchema = v.pipe(v.string(), v.maxLength(LIMITS.labelName));
const FilterNameSchema = v.pipe(v.string(), v.maxLength(LIMITS.filterName));
const FilterQuerySchema = v.pipe(v.string(), v.maxLength(LIMITS.filterQuery));
const CommentContentSchema = v.pipe(
	v.string(),
	v.maxLength(LIMITS.taskComment),
);

// ── Priority schema (internal building block) ──
const PriorityValueSchema = v.pipe(
	v.union([v.string(), v.number()]),
	v.toNumber(),
	v.integer(),
	v.minValue(1),
	v.maxValue(4),
);
const PrioritySchema = v.optional(PriorityValueSchema);

// ── Update task fields ──
export const UpdateTaskFieldsSchema = v.object({
	title: v.optional(TaskContentSchema),
	project: v.optional(v.string()),
	due: v.optional(DueStringSchema),
	priority: PrioritySchema,
	addLabels: v.optional(v.array(LabelNameSchema)),
	removeLabels: v.optional(v.array(LabelNameSchema)),
	description: v.optional(TaskDescriptionSchema),
	section: v.optional(v.string()),
});

export const parseUpdateTaskFields = v.parser(UpdateTaskFieldsSchema);
export type UpdateTaskFields = v.InferOutput<typeof UpdateTaskFieldsSchema>;

export const UpdateTaskCliFields = defineCliFields(UpdateTaskFieldsSchema, {
	title: { description: "new task title" },
	due: {
		description: 'due date (natural language: "tomorrow", "2026-05-10")',
	},
	priority: { description: "priority 1-4 (4=urgent)", coerce: "number" },
	addLabels: {
		aliasFrom: "label",
		description: "label(s) to add; comma-separated for multiple (e.g. urgent,work)",
		coerce: "csv",
	},
	removeLabels: {
		aliasFrom: "removeLabel",
		description:
			"label(s) to remove; comma-separated for multiple (e.g. urgent,work)",
		coerce: "csv",
	},
	description: { description: "task description" },
});

// ── Add task fields ──
export const AddTaskFieldsSchema = v.object({
	title: TaskContentSchema,
	project: v.optional(v.string()),
	parentId: v.optional(v.string()),
	section: v.optional(v.string()),
	description: v.optional(TaskDescriptionSchema),
	due: v.optional(DueStringSchema),
	priority: PrioritySchema,
	labels: v.optional(v.array(LabelNameSchema)),
});

export const parseAddTaskFields = v.parser(AddTaskFieldsSchema);
export type AddTaskFields = v.InferOutput<typeof AddTaskFieldsSchema>;

export const AddTaskCliFields = defineCliFields(AddTaskFieldsSchema, {
	title: { required: true, description: "task title" },
	project: { description: "project id" },
	parentId: {
		aliasFrom: "parent",
		description: "parent task id (creates a subtask)",
	},
	due: {
		description: 'due date (natural language: "tomorrow", "2026-05-10")',
	},
	priority: { description: "priority 1-4 (4=urgent)", coerce: "number" },
	labels: {
		aliasFrom: "label",
		description:
			"label name(s); comma-separated for multiple (e.g. urgent,work)",
		coerce: "csv",
	},
	description: { description: "task description" },
});

// ── MCP input: tasks update ──
export const TasksUpdateInputSchema = v.object({
	id: v.string(),
	...UpdateTaskFieldsSchema.entries,
});

export type TasksUpdateInput = v.InferOutput<typeof TasksUpdateInputSchema>;

// ── List/filter tasks ──
export const ListTaskSchema = v.object({
	project: v.exactOptional(v.string()),
	due: v.exactOptional(v.picklist(["today", "overdue"] as const)),
	priority: v.exactOptional(PriorityValueSchema),
	label: v.exactOptional(v.string()),
	details: v.exactOptional(v.boolean()),
	limit: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	offset: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	sync: v.exactOptional(v.boolean()),
});

export type ListTaskOptions = v.InferOutput<typeof ListTaskSchema>;

export const ListTaskCliFields = defineCliFields(ListTaskSchema, {
	project: { description: "filter by project id" },
	due: { description: "filter by due date (today, overdue)" },
	priority: { description: "filter by priority (1-4)", coerce: "number" },
	label: { description: "filter by label name" },
	details: { description: "return full task data instead of id/content only" },
	limit: {
		description: "maximum number of tasks to return",
		coerce: "number",
	},
	offset: { description: "number of tasks to skip", coerce: "number" },
	sync: { description: "sync before listing" },
});

// ── Add filter fields ──
export const AddFilterFieldsSchema = v.object({
	name: FilterNameSchema,
	query: FilterQuerySchema,
	color: v.optional(v.nullable(v.string())),
	itemOrder: v.optional(v.number()),
	isFavorite: v.optional(v.boolean()),
});

export const parseAddFilterFields = v.parser(AddFilterFieldsSchema);
export type AddFilterFields = v.InferOutput<typeof AddFilterFieldsSchema>;

export const AddFilterCliFields = defineCliFields(AddFilterFieldsSchema, {
	name: { positional: true, required: true, description: "filter name" },
	query: {
		positional: true,
		required: true,
		description: "filter query (Todoist syntax)",
	},
	color: { description: "filter color" },
	itemOrder: { description: "filter order position", coerce: "number" },
	isFavorite: { description: "mark as favorite" },
});

// ── Update filter fields ──
export const UpdateFilterFieldsSchema = v.object({
	name: v.optional(FilterNameSchema),
	query: v.optional(FilterQuerySchema),
	color: v.optional(v.nullable(v.string())),
	itemOrder: v.optional(v.number()),
	isFavorite: v.optional(v.boolean()),
});

export const parseUpdateFilterFields = v.parser(UpdateFilterFieldsSchema);
export type UpdateFilterFields = v.InferOutput<typeof UpdateFilterFieldsSchema>;

export const UpdateFilterCliFields = defineCliFields(UpdateFilterFieldsSchema, {
	name: { description: "new filter name" },
	query: { description: "new filter query" },
	color: { description: "new filter color" },
	itemOrder: { description: "new filter order", coerce: "number" },
	isFavorite: { description: "set favorite status" },
});

// ── Run filter query (MCP/CLI input) ──
export const FilterQueryInputSchema = v.object({
	query: FilterQuerySchema,
	limit: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)),
	),
	sync: v.optional(v.boolean(), false),
});

export const parseFilterQueryInput = v.parser(FilterQueryInputSchema);
export type FilterQueryInput = v.InferOutput<typeof FilterQueryInputSchema>;

export const FilterQueryCliFields = defineCliFields(FilterQueryInputSchema, {
	query: {
		positional: true,
		required: true,
		description: "filter query (Todoist syntax)",
	},
	limit: {
		description: "max tasks to return (1-200, default 50)",
		coerce: "number",
	},
});

// ── Add comment fields ──
export const AddCommentFieldsSchema = v.object({
	taskId: v.string(),
	content: CommentContentSchema,
});

export const parseAddCommentFields = v.parser(AddCommentFieldsSchema);
export type AddCommentFields = v.InferOutput<typeof AddCommentFieldsSchema>;

export const AddCommentCliFields = defineCliFields(AddCommentFieldsSchema, {
	taskId: { positional: true, required: true, aliasFrom: "task", description: "task id" },
	content: {
		positional: true,
		required: true,
		description: "comment content",
	},
});
