import * as v from "valibot";
import { resolveProject } from "./commands/projects.ts";
import { getTask, mergeLabelAdd, mergeLabelRemove } from "./commands/tasks.ts";
import { listProjectIds } from "./config.ts";
import {
	type DbTask,
	getSyncToken,
	setSyncToken,
	type SyncDb,
	upsertTask,
} from "./db.ts";
import { sync } from "./sync.ts";
import type { TodoistClient } from "./todoist.ts";

export const PrioritySchema = v.optional(
	v.pipe(
		v.union([v.string(), v.number()]),
		v.toNumber(),
		v.integer(),
		v.minValue(1),
		v.maxValue(4),
	),
);

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

export const AddTaskFieldsSchema = v.object({
	title: v.string(),
	project: v.optional(v.string()),
	section: v.optional(v.string()),
	due: v.optional(v.string()),
	priority: PrioritySchema,
	labels: v.optional(v.array(v.string())),
});

export const parseAddTaskFields = v.parser(AddTaskFieldsSchema);

export type AddTaskFields = v.InferOutput<typeof AddTaskFieldsSchema>;

async function syncAndCheck(
	db: SyncDb,
	client: TodoistClient,
	rcPath: string,
	id: string,
): Promise<{ conflict: true; upstream: DbTask | null } | null> {
	const projects = listProjectIds(rcPath);
	const { updatedTaskIds } = await sync(db, client, projects);
	return updatedTaskIds.has(id)
		? { conflict: true, upstream: getTask(db, id) }
		: null;
}

export async function completeTask(
	db: SyncDb,
	client: TodoistClient,
	rcPath: string,
	id: string,
): Promise<{ conflict: true; upstream: DbTask | null } | { ok: true }> {
	const conflict = await syncAndCheck(db, client, rcPath, id);
	if (conflict) {
		return conflict;
	}
	const { syncToken } = await client.completeTask(id, getSyncToken(db));
	if (syncToken) {
		setSyncToken(db, syncToken);
	}
	db.run(
		db.q
			.updateTable("tasks")
			.set({ is_completed: 1, synced_at: new Date().toISOString() })
			.where("id", "=", id)
			.compile(),
	);
	return { ok: true };
}

export async function updateTask(
	db: SyncDb,
	client: TodoistClient,
	rcPath: string,
	id: string,
	{
		title,
		due,
		priority,
		addLabels,
		removeLabels,
		description,
		section,
	}: UpdateTaskFields,
): Promise<{ conflict: true; upstream: DbTask | null } | DbTask> {
	const conflict = await syncAndCheck(db, client, rcPath, id);
	if (conflict) {
		return conflict;
	}
	let labels: string[] | undefined;
	if (addLabels !== undefined || removeLabels !== undefined) {
		const existing = getTask(db, id);
		let current = existing?.labels ?? null;
		if (addLabels !== undefined) {
			for (const l of addLabels) {
				const added = mergeLabelAdd(current, l);
				current = JSON.stringify(added);
			}
		}
		if (removeLabels !== undefined) {
			for (const l of removeLabels) {
				const removed = mergeLabelRemove(current, l);
				current = JSON.stringify(removed);
			}
		}
		labels = JSON.parse(current ?? "[]") as string[];
	}
	const { task: updated, syncToken } = await client.updateTask(
		id,
		{
			title,
			description,
			due,
			priority,
			labels,
			sectionId: section,
		},
		getSyncToken(db),
	);
	if (syncToken) {
		setSyncToken(db, syncToken);
	}
	upsertTask(db, updated);
	return updated;
}

export async function addTask(
	db: SyncDb,
	client: TodoistClient,
	{ title, project, section, due, priority, labels }: AddTaskFields,
): Promise<DbTask> {
	const projectId = project ? resolveProject(db, project) : undefined;
	const { task, syncToken } = await client.addTask(
		{
			title,
			projectId,
			sectionId: section,
			due,
			priority,
			labels,
		},
		getSyncToken(db),
	);
	if (syncToken) {
		setSyncToken(db, syncToken);
	}
	upsertTask(db, task);
	return task;
}
