/**
 * Todoist API schema transformations.
 *
 * Pure functions that translate between:
 * - Todoist API types → Database types (for storage)
 * - Database types → App types (for reading, with camelCase normalization)
 *
 * No side effects, no DB access. Pure translation layer.
 */

import type { DbLabel, DbProject, DbSection, DbTask } from "./db.ts";
import type { SyncItem, SyncLabel, SyncProject, SyncSection } from "./sdk.ts";

// App-facing types (camelCase)
export type AppTask = {
	id: string;
	url: string;
	projectId: string | null;
	sectionId: string | null;
	parentId: string | null;
	childOrder: number | null;
	noteCount: number | null;
	updatedAt: string | null;
	content: string;
	description: string | null;
	priority: number | null;
	due: { date: string; string: string; isRecurring: boolean } | null;
	labels: string[];
	isCompleted: boolean;
	createdAt: string | null;
};

export type AppProject = {
	id: string;
	name: string;
	color: string | null;
	isFavorite: boolean;
	isInbox: boolean;
};

export type AppSection = {
	id: string;
	projectId: string;
	name: string;
	sectionOrder: number | null;
};

export type AppLabel = {
	id: string;
	name: string;
	color: string | null;
};

/**
 * Get current timestamp in ISO format.
 */
function now(): string {
	return new Date().toISOString();
}

/**
 * Prepare a Todoist sync item for database storage.
 *
 * Transforms:
 * - due (object with date/string/is_recurring) → due_date and due_string columns
 * - labels (array) → JSON string
 * - checked → is_completed (0/1)
 * - added_at → created_at
 */
export function prepareTaskForDB(
	t: SyncItem,
	syncedAt: string = now(),
): DbTask {
	return {
		id: t.id,
		project_id: t.project_id,
		section_id: t.section_id,
		parent_id: t.parent_id ?? null,
		child_order: t.child_order ?? 0,
		note_count: t.note_count ?? 0,
		updated_at: t.updated_at ?? null,
		content: t.content,
		description: t.description,
		priority: t.priority,
		due_date: t.due?.date ?? null,
		due_string: t.due?.string ?? null,
		is_recurring: t.due?.is_recurring ? 1 : 0,
		labels: JSON.stringify(t.labels),
		is_completed: t.checked ? 1 : 0,
		created_at: t.added_at ?? null,
		synced_at: syncedAt,
	};
}

/**
 * Normalize a database task to app-facing format (camelCase).
 *
 * Transforms:
 * - due_date + due_string → due object
 * - labels (JSON string) → array
 * - is_completed (0/1) → completed (boolean)
 * - created_at → createdAt
 * - snake_case → camelCase
 */
export function normalizeTask(t: DbTask): AppTask {
	const dueDate = t.due_date;
	const dueString = t.due_string;
	const due =
		dueDate || dueString
			? {
					date: dueDate ?? "",
					string: dueString ?? "",
					isRecurring: t.is_recurring === 1,
				}
			: null;

	return {
		id: t.id,
		url: `https://app.todoist.com/app/task/${t.id}`,
		projectId: t.project_id,
		sectionId: t.section_id,
		parentId: t.parent_id,
		childOrder: t.child_order,
		noteCount: t.note_count,
		updatedAt: t.updated_at,
		content: t.content,
		description: t.description,
		priority: t.priority,
		due,
		labels: t.labels ? (JSON.parse(t.labels) as string[]) : [],
		isCompleted: t.is_completed === 1,
		createdAt: t.created_at,
	};
}

/**
 * Prepare a Todoist project for database storage.
 *
 * Filters deleted/archived projects.
 * Transforms:
 * - is_favorite (boolean) → is_favorite (0/1)
 * - inbox_project (boolean) → is_inbox (0/1)
 */
export function prepareProjectForDB(
	p: SyncProject,
	syncedAt: string = now(),
): DbProject | null {
	if (p.is_deleted || p.is_archived) {
		return null;
	}
	return {
		id: p.id,
		name: p.name,
		color: p.color ?? null,
		is_favorite: p.is_favorite ? 1 : 0,
		is_inbox: p.inbox_project ? 1 : 0,
		synced_at: syncedAt,
	};
}

/**
 * Normalize a database project to app-facing format (camelCase).
 *
 * Transforms:
 * - is_favorite (0/1) → isFavorite (boolean)
 * - is_inbox (0/1) → isInbox (boolean)
 * - snake_case → camelCase
 */
export function normalizeProject(p: DbProject): AppProject {
	return {
		id: p.id,
		name: p.name,
		color: p.color,
		isFavorite: p.is_favorite === 1,
		isInbox: p.is_inbox === 1,
	};
}

/**
 * Prepare a Todoist section for database storage.
 *
 * Filters deleted/archived sections.
 * Transforms:
 * - project_id stays as-is
 */
export function prepareSectionForDB(
	s: SyncSection,
	syncedAt: string = now(),
): DbSection | null {
	if (s.is_deleted || s.is_archived) {
		return null;
	}
	return {
		id: s.id,
		project_id: s.project_id,
		name: s.name,
		section_order: s.section_order,
		synced_at: syncedAt,
	};
}

/**
 * Normalize a database section to app-facing format (camelCase).
 *
 * Transforms:
 * - section_order → sectionOrder
 * - project_id → projectId
 */
export function normalizeSection(s: DbSection): AppSection {
	return {
		id: s.id,
		projectId: s.project_id,
		name: s.name,
		sectionOrder: s.section_order,
	};
}

/**
 * Prepare a Todoist label for database storage.
 *
 * Filters deleted labels.
 */
export function prepareLabelForDB(
	l: SyncLabel,
	syncedAt: string = now(),
): DbLabel | null {
	if (l.is_deleted) {
		return null;
	}
	return {
		id: l.id,
		name: l.name,
		color: l.color ?? null,
		synced_at: syncedAt,
	};
}

/**
 * Normalize a database label to app-facing format (camelCase).
 *
 * No field transformations needed, just a type wrapper.
 */
export function normalizeLabel(l: DbLabel): AppLabel {
	return {
		id: l.id,
		name: l.name,
		color: l.color,
	};
}
