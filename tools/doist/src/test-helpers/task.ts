/**
 * Test utilities and fixtures for task command tests.
 */

export const NOW = new Date().toISOString();
export const TODAY = new Date().toISOString().slice(0, 10);

// Semantic IDs for test data
export const PROJECT_IDS = {
	work: "proj-work",
};

export const TASK_IDS = {
	alpha: "task-alpha",
	beta: "task-beta",
	overdue: "task-overdue",
	done: "task-done",
};

// Task type definition
export type TestTask = {
	id: string;
	project_id: string;
	section_id: string | null;
	description: string | null;
	created_at: string;
	synced_at: string;
	is_completed: number;
	due_date: string | null;
	due_string: string | null;
	labels: string | null;
	priority: number;
	content: string;
};

// Project fixture
export const PROJECT_WORK = {
	id: PROJECT_IDS.work,
	name: "Work",
	color: null,
	is_favorite: 0,
	is_inbox: 0,
	synced_at: NOW,
};

/**
 * Create a task with sensible defaults.
 *
 * @param id - Task ID
 * @param overrides - Property overrides
 * @returns Task object with defaults merged
 */
export function createTask(
	id: string,
	overrides: Partial<Omit<TestTask, "id">> = {},
): TestTask {
	const base: Omit<TestTask, "id"> = {
		project_id: PROJECT_IDS.work,
		section_id: null,
		description: null,
		created_at: NOW,
		synced_at: NOW,
		is_completed: 0,
		due_date: null,
		due_string: null,
		labels: JSON.stringify([]),
		priority: 1,
		content: "",
	};
	return { id, ...base, ...overrides };
}

// Task fixtures
export const TASK_ALPHA = createTask(TASK_IDS.alpha, {
	content: "Alpha task",
	priority: 1,
	due_date: TODAY,
	due_string: "today",
});

export const TASK_BETA = createTask(TASK_IDS.beta, {
	content: "Beta task",
	priority: 4,
	due_date: "2030-01-01",
	due_string: "Jan 1 2030",
	labels: JSON.stringify(["urgent"]),
});

export const TASK_OVERDUE = createTask(TASK_IDS.overdue, {
	content: "Overdue task",
	priority: 2,
	due_date: "2020-01-01",
	due_string: "Jan 1 2020",
});

export const TASK_DONE = createTask(TASK_IDS.done, {
	content: "Done task",
	is_completed: 1,
});
