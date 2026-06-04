/**
 * Centralized test fixtures for db and operations tests.
 */

import type { DbProject, DbSection, DbTask } from "../db.ts";
import type { AllData } from "../todoist.ts";

export const NOW = new Date().toISOString();

// ── Project fixtures ────────────────────────────────────────────────

export const PROJECT_IDS = {
	work: "p-work",
	personal: "p-personal",
	inbox: "p-inbox",
};

export const PROJECT_WORK = {
	id: PROJECT_IDS.work,
	name: "Work",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

export const PROJECT_PERSONAL = {
	id: PROJECT_IDS.personal,
	name: "Personal",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

export const PROJECT_INBOX = {
	id: PROJECT_IDS.inbox,
	name: "Inbox",
	color: "blue",
	is_favorite: 0,
	is_inbox: 1,
	synced_at: NOW,
};

// ── Section fixtures ────────────────────────────────────────────────

export const SECTION_IDS = {
	backlog: "s-backlog",
	inProgress: "s-in-progress",
	someday: "s-someday",
	thisWeek: "s-this-week",
};

export const SECTION_BACKLOG = {
	id: SECTION_IDS.backlog,
	project_id: PROJECT_IDS.work,
	name: "Backlog",
	section_order: 2,
	synced_at: NOW,
};

export const SECTION_IN_PROGRESS = {
	id: SECTION_IDS.inProgress,
	project_id: PROJECT_IDS.work,
	name: "In Progress",
	section_order: 1,
	synced_at: NOW,
};

export const SECTION_SOMEDAY = {
	id: SECTION_IDS.someday,
	project_id: PROJECT_IDS.personal,
	name: "Someday",
	section_order: 1,
	synced_at: NOW,
};

export const SECTION_THIS_WEEK = {
	id: SECTION_IDS.thisWeek,
	project_id: PROJECT_IDS.inbox,
	name: "This Week",
	section_order: 1,
	synced_at: NOW,
};

// ── Label fixtures ────────────────────────────────────────────────

export const LABEL_IDS = {
	urgent: "l-urgent",
	work: "l-work",
	home: "l-home",
};

export const LABEL_URGENT = {
	id: LABEL_IDS.urgent,
	name: "urgent",
	color: "red",
	synced_at: NOW,
};

export const LABEL_WORK = {
	id: LABEL_IDS.work,
	name: "work",
	color: null,
	synced_at: NOW,
};

export const LABEL_HOME = {
	id: LABEL_IDS.home,
	name: "home",
	color: null,
	synced_at: NOW,
};

// ── Task fixtures ────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

export const TASK_IDS = {
	alpha: "t-alpha",
	beta: "t-beta",
	overdue: "t-overdue",
	done: "t-done",
};

export const TASK_ALPHA = {
	id: TASK_IDS.alpha,
	project_id: PROJECT_IDS.work,
	section_id: SECTION_IDS.inProgress,
	parent_id: null,
	child_order: 1,
	note_count: 0,
	updated_at: NOW,
	content: "Alpha task",
	description: null,
	priority: 1,
	due_date: TODAY,
	due_string: "today",
	labels: "[]",
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

export const TASK_BETA = {
	id: TASK_IDS.beta,
	project_id: PROJECT_IDS.work,
	section_id: SECTION_IDS.backlog,
	parent_id: null,
	child_order: 2,
	note_count: 1,
	updated_at: NOW,
	content: "Beta task",
	description: null,
	priority: 4,
	due_date: "2030-01-01",
	due_string: "Jan 1 2030",
	labels: JSON.stringify([LABEL_IDS.urgent]),
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

export const TASK_OVERDUE = {
	id: TASK_IDS.overdue,
	project_id: PROJECT_IDS.work,
	section_id: null,
	parent_id: null,
	child_order: 3,
	note_count: 0,
	updated_at: NOW,
	content: "Overdue task",
	description: null,
	priority: 2,
	due_date: "2020-01-01",
	due_string: "Jan 1 2020",
	labels: "[]",
	is_completed: 0,
	created_at: NOW,
	synced_at: NOW,
};

export const TASK_DONE = {
	id: TASK_IDS.done,
	project_id: PROJECT_IDS.work,
	section_id: null,
	parent_id: null,
	child_order: 4,
	note_count: 0,
	updated_at: NOW,
	content: "Done task",
	description: null,
	priority: 1,
	due_date: null,
	due_string: null,
	labels: "[]",
	is_completed: 1,
	created_at: NOW,
	synced_at: NOW,
};

export function makeData(overrides: Partial<AllData> = {}): AllData {
	return {
		projects: [],
		sections: [],
		labels: [],
		tasks: [],
		completedTaskIds: [],
		deletedTaskIds: [],
		syncToken: "sync-token",
		...overrides,
	};
}

export function makeProject(id: string, name: string): DbProject {
	return {
		id,
		name,
		color: null,
		is_favorite: 0,
		is_inbox: 0,
		synced_at: NOW,
	};
}

export function makeSection(id: string, projectId: string): DbSection {
	return {
		id,
		project_id: projectId,
		name: "S",
		section_order: 0,
		synced_at: NOW,
	};
}

export function makeTask(id: string, projectId: string): DbTask {
	return {
		id,
		project_id: projectId,
		section_id: null,
		parent_id: null,
		child_order: 0,
		note_count: 0,
		updated_at: NOW,
		content: "T",
		description: null,
		priority: 1,
		due_date: null,
		due_string: null,
		labels: "[]",
		is_completed: 0,
		created_at: null,
		synced_at: NOW,
	};
}
