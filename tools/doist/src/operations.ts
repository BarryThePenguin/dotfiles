import { Database } from "./db.ts";
import { normalizeTask, type AppTask } from "./schema.ts";
import { type AddTaskFields, type UpdateTaskFields } from "./schemas.ts";
import { getToken, persistMutations } from "./sync-lifecycle.ts";
import type { TodoistClient } from "./todoist.ts";
import { createItemCompleteCommand } from "./sdk.ts";

/**
 * Resolve a project name or ID.
 * If the input matches exactly one project by name, return its ID.
 * Otherwise, return the input as-is (assumed to be a raw ID).
 */
export function resolveProject(db: Database, nameOrId: string): string {
	const rows = db.selectProjectByName(nameOrId);
	const [firstRow] = rows;
	if (firstRow && rows.length === 1) {
		return firstRow.id;
	}
	return nameOrId;
}

export function listSections(db: Database, project?: string) {
	const projectId = project ? resolveProject(db, project) : undefined;

	if (projectId) {
		return db.selectSectionsByProjectId(projectId);
	} else {
		return db.selectAllSections();
	}
}

/**
 * Add a label to the existing label set, avoiding duplicates.
 */
function mergeLabelAdd(stored: string[] | null, label: string): string[] {
	const current = stored ?? [];
	return current.includes(label) ? current : [...current, label];
}

/**
 * Remove a label from the existing label set.
 */
function mergeLabelRemove(stored: string[] | null, label: string): string[] {
	return (stored ?? []).filter((l) => l !== label);
}

export interface OperationResult<T> {
	ok: boolean;
	result?: T | undefined;
}

/**
 * Update a task with new field values.
 *
 * @returns { ok: true, result: updatedTask } on success
 */
export async function updateTask(
	db: Database,
	client: TodoistClient,
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
): Promise<OperationResult<AppTask>> {
	// Compute merged labels
	let labels: string[] | undefined;
	if (addLabels !== undefined || removeLabels !== undefined) {
		const existing = db.selectTaskById(id) ?? null;
		let current = existing?.labels ?? null;
		if (addLabels !== undefined) {
			for (const l of addLabels) {
				current = mergeLabelAdd(current, l);
			}
		}
		if (removeLabels !== undefined) {
			for (const l of removeLabels) {
				current = mergeLabelRemove(current, l);
			}
		}
		labels = current ?? [];
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
		getToken(db),
	);

	persistMutations(db, {
		token: syncToken,
		tasks: [updated],
	});
	return { ok: true, result: normalizeTask(updated) };
}

/**
 * Add a new task.
 *
 * Returns a promise with either:
 * - { ok: true, result: newTask } on success
 */
export async function addTask(
	db: Database,
	client: TodoistClient,
	{
		title,
		project,
		section,
		description,
		due,
		priority,
		labels,
	}: AddTaskFields,
): Promise<OperationResult<AppTask>> {
	const projectId = project ? resolveProject(db, project) : undefined;
	const { task, syncToken } = await client.addTask(
		{
			title,
			projectId,
			sectionId: section,
			description,
			due,
			priority,
			labels,
		},
		getToken(db),
	);
	persistMutations(db, {
		token: syncToken,
		tasks: [task],
	});
	return { ok: true, result: normalizeTask(task) };
}

/**
 * Complete multiple tasks in a single API call.
 *
 * Batches all complete commands and sends them to Todoist atomically.
 *
 * @returns { ok: true, count: number of completed tasks } on success
 */
export async function completeTasks(
	db: Database,
	client: TodoistClient,
	ids: string[],
): Promise<OperationResult<number>> {
	if (ids.length === 0) {
		return { ok: true, result: 0 };
	}

	const now = new Date().toISOString();
	const commands = ids.map((id) =>
		createItemCompleteCommand({ id, completed_at: now }),
	);

	const { syncToken } = await client.sync(getToken(db), ...commands);

	persistMutations(db, {
		token: syncToken,
		customOperations: (db) => {
			db.updateTasksAsCompleted(ids);
		},
	});

	return { ok: true, result: ids.length };
}
