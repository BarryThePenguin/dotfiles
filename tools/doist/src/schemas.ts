/**
 * Centralized validation schemas for Doist operations.
 *
 * This module owns all input validation for task operations, ensuring a single
 * source of truth for what fields can be set and what values are valid.
 */

import * as v from "valibot";

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
	title: v.optional(v.string()),
	due: v.optional(v.string()),
	priority: PrioritySchema,
	addLabels: v.optional(v.array(v.string())),
	removeLabels: v.optional(v.array(v.string())),
	description: v.optional(v.string()),
	section: v.optional(v.string()),
});

export const parseUpdateTaskFields = v.parser(UpdateTaskFieldsSchema);
export type UpdateTaskFields = v.InferOutput<typeof UpdateTaskFieldsSchema>;

// ── Add task fields ──
export const AddTaskFieldsSchema = v.object({
	title: v.string(),
	project: v.optional(v.string()),
	section: v.optional(v.string()),
	description: v.optional(v.string()),
	due: v.optional(v.string()),
	priority: PrioritySchema,
	labels: v.optional(v.array(v.string())),
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
	project: v.optional(v.string()),
	due: v.optional(v.picklist(["today", "overdue"] as const)),
	priority: v.optional(PrioritySchema),
	label: v.optional(v.string()),
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	sync: v.exactOptional(v.boolean()),
});

export type ListTaskOptions = v.InferOutput<typeof ListTaskSchema>;
