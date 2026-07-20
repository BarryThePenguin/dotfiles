import { Database } from "./db.ts";
import { normalizeTask, type AppTask } from "./schema.ts";
import { type AddTaskFields, type UpdateTaskFields } from "./schemas.ts";
import {
	createAddCommand,
	createItemCloseCommand,
	createItemMoveCommand,
	createItemUncompleteCommand,
	createUpdateCommand,
	type SyncCommand,
} from "./sdk.ts";
import { getToken, persistMutations } from "./sync-lifecycle.ts";
import { resolveCreated, type TodoistClient } from "./todoist.ts";

/**
 * Resolve a project name or ID.
 * If the input matches exactly one project by name, return its ID.
 * If the input matches an allowed project ID, return it as-is.
 * Otherwise, return undefined.
 */
export function resolveProject(
	db: Database,
	nameOrId: string,
): string | undefined {
	const rows = db.selectProjects({ name: { value: nameOrId, match: "like" } });
	const [firstRow] = rows;
	if (firstRow && rows.length === 1) {
		return firstRow.id;
	}
	if (db.getProjectById(nameOrId)) {
		return nameOrId;
	}
	return undefined;
}

export function listSections(db: Database, project?: string) {
	if (!project) {
		return db.selectAllSections();
	}

	const projectId = resolveProject(db, project);
	if (!projectId) {
		return [];
	}

	return db.selectSectionsByProjectId(projectId);
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
	result: T;
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
		project,
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
		const existing = db.getTaskById(id);
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

	const projectId = project ? resolveProject(db, project) : undefined;
	if (project && projectId === undefined) {
		throw new Error(`project not found in .doistrc: ${project}`);
	}

	const commands: SyncCommand[] = [];
	if (projectId !== undefined) {
		commands.push(createItemMoveCommand({ id, project_id: projectId }));
	}
	const updateFields = {
		title,
		description,
		due,
		priority,
		labels,
		sectionId: section,
	};
	const hasUpdateFields =
		title !== undefined ||
		description !== undefined ||
		due !== undefined ||
		priority !== undefined ||
		labels !== undefined ||
		section !== undefined;
	if (hasUpdateFields) {
		commands.push(createUpdateCommand(id, updateFields));
	}

	const allData = await client.sync(getToken(db), ...commands);
	const updated = allData.tasks.find((t) => t.id === id);
	if (!updated) {
		throw new Error(`updated task ${id} not in sync response`);
	}

	persistMutations(db, { token: allData.syncToken, tasks: [updated] });
	return { ok: true, result: normalizeTask(updated) };
}

/**
 * Move a task to a different project.
 *
 * @returns { ok: true, result: movedTask } on success
 */
export async function moveTask(
	db: Database,
	client: TodoistClient,
	id: string,
	project: string,
): Promise<OperationResult<AppTask>> {
	const projectId = resolveProject(db, project);
	if (!projectId) {
		throw new Error(`project not found in .doistrc: ${project}`);
	}

	const allData = await client.sync(
		getToken(db),
		createItemMoveCommand({ id, project_id: projectId }),
	);
	const moved = allData.tasks.find((t) => t.id === id);
	if (!moved) {
		throw new Error(`moved task ${id} not in sync response`);
	}

	persistMutations(db, { token: allData.syncToken, tasks: [moved] });
	return { ok: true, result: normalizeTask(moved) };
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
		parentId,
		section,
		description,
		due,
		priority,
		labels,
	}: AddTaskFields,
): Promise<OperationResult<AppTask>> {
	const projectId = project
		? (resolveProject(db, project) ?? project)
		: undefined;
	const tempId = crypto.randomUUID();
	const allData = await client.sync(
		getToken(db),
		createAddCommand(
			{
				title,
				projectId,
				parentId,
				sectionId: section,
				description,
				due,
				priority,
				labels,
			},
			tempId,
		),
	);
	const task = resolveCreated(allData, tempId);
	persistMutations(db, { token: allData.syncToken, tasks: [task] });
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

	const commands = ids.map((id) => createItemCloseCommand({ id }));
	const allData = await client.sync(getToken(db), ...commands);
	const completedIds =
		allData.completedTaskIds.length > 0 ? allData.completedTaskIds : ids;

	persistMutations(db, {
		token: allData.syncToken,
		tasks: allData.tasks,
		customOperations: (db) => {
			db.updateTasksAsCompleted(completedIds);
		},
	});

	return { ok: true, result: completedIds.length };
}

/**
 * Reopen multiple completed tasks in a single API call.
 *
 * Batches all uncomplete commands and sends them to Todoist atomically.
 *
 * @returns { ok: true, count: number of reopened tasks } on success
 */
export async function uncompleteTasks(
	db: Database,
	client: TodoistClient,
	ids: string[],
): Promise<OperationResult<number>> {
	if (ids.length === 0) {
		return { ok: true, result: 0 };
	}

	const commands = ids.map((id) => createItemUncompleteCommand({ id }));

	const { syncToken } = await client.sync(getToken(db), ...commands);

	persistMutations(db, {
		token: syncToken,
		customOperations: (db) => {
			db.updateTasksAsIncomplete(ids);
		},
	});

	return { ok: true, result: ids.length };
}
