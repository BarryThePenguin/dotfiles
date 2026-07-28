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
const PrioritySchema = v.optional(
	v.pipe(
		v.union([v.string(), v.number()]),
		v.toNumber(),
		v.integer(),
		v.minValue(1),
		v.maxValue(4),
	),
);

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
	priority: v.exactOptional(PrioritySchema),
	label: v.exactOptional(v.string()),
	details: v.exactOptional(v.boolean()),
	limit: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	offset: v.exactOptional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	sync: v.exactOptional(v.boolean()),
});

export type ListTaskOptions = v.InferOutput<typeof ListTaskSchema>;

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

// ── Add comment fields ──
export const AddCommentFieldsSchema = v.object({
	taskId: v.string(),
	content: CommentContentSchema,
});

export const parseAddCommentFields = v.parser(AddCommentFieldsSchema);
export type AddCommentFields = v.InferOutput<typeof AddCommentFieldsSchema>;
