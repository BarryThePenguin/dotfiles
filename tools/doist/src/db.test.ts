import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./db.ts";
import { listSections } from "./operations.ts";
import { getToken, setToken } from "./sync-lifecycle.ts";
import { openDb } from "./test-helpers/database.ts";
import {
	LABEL_HOME,
	LABEL_IDS,
	LABEL_URGENT,
	LABEL_WORK,
	PROJECT_INBOX,
	PROJECT_IDS,
	PROJECT_PERSONAL,
	PROJECT_WORK,
	SECTION_BACKLOG,
	SECTION_IDS,
	SECTION_IN_PROGRESS,
	SECTION_SOMEDAY,
	SECTION_THIS_WEEK,
	TASK_ALPHA,
	TASK_BETA,
	TASK_DONE,
	TASK_IDS,
	TASK_OVERDUE,
} from "./test-helpers/fixtures.ts";

// ── Token persistence tests ────────────────────────────────────────────────

describe("token operations", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
	});

	afterEach(() => {
		db.close();
	});

	it("getToken returns null when no token has been saved", () => {
		expect(getToken(db)).toBeNull();
	});

	it("getToken / setToken round-trips a token", () => {
		setToken(db, "abc123");
		expect(getToken(db)).toBe("abc123");
	});

	it("setToken overwrites the previous token", () => {
		setToken(db, "first");
		setToken(db, "second");
		expect(getToken(db)).toBe("second");
	});
});

// ── Database initialization tests ────────────────────────────────────────────────

describe("database initialization", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
	});

	afterEach(() => {
		db.close();
	});

	it("openDb creates all four tables", () => {
		// Verify that the four main tables exist by checking if we can query them
		const projects = db.selectAllProjects();
		const sections = db.selectAllSections();
		const labels = db.selectAllLabels();
		expect(projects).toEqual([]);
		expect(sections).toEqual([]);
		expect(labels).toEqual([]);
	});
});

// ── CRUD operations tests ────────────────────────────────────────────────

describe("CRUD operations", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
	});

	afterEach(() => {
		db.close();
	});

	describe("projects", () => {
		it("upsertProject inserts a project", () => {
			db.upsertProject(PROJECT_INBOX);
			const rows = db.selectAllProjects();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				name: "Inbox",
				isInbox: true,
			});
		});

		it("upsertProject is idempotent — running twice yields one row with updated values", () => {
			db.upsertProject(PROJECT_INBOX);
			db.upsertProject({ ...PROJECT_INBOX, name: "Updated Inbox" });
			const rows = db.selectAllProjects();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.name).toBe("Updated Inbox");
		});

		it("upsertProject handles multiple projects", () => {
			db.upsertProject(PROJECT_INBOX);
			db.upsertProject(PROJECT_WORK);
			db.upsertProject(PROJECT_PERSONAL);
			const rows = db.selectAllProjects();
			expect(rows).toHaveLength(3);
		});
	});

	describe("sections", () => {
		it("upsertSection inserts a section", () => {
			db.upsertSection(SECTION_THIS_WEEK);
			const rows = db.selectSectionsByProjectId(PROJECT_IDS.inbox);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.name).toBe("This Week");
		});

		it("upsertSection is idempotent", () => {
			db.upsertSection(SECTION_THIS_WEEK);
			db.upsertSection({ ...SECTION_THIS_WEEK, name: "Next Week" });
			const rows = db.selectAllSections();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.name).toBe("Next Week");
		});

		it("upsertSection maintains section order within a project", () => {
			db.upsertSection(SECTION_BACKLOG);
			db.upsertSection(SECTION_IN_PROGRESS);
			const rows = db.selectSectionsByProjectId(PROJECT_IDS.work);
			expect(rows).toHaveLength(2);
			// In Progress has order_: 1, Backlog has order_: 2
			expect(rows[0]?.id).toBe(SECTION_IDS.inProgress);
			expect(rows[1]?.id).toBe(SECTION_IDS.backlog);
		});
	});

	describe("labels", () => {
		it("upsertLabel inserts a label", () => {
			db.upsertLabel(LABEL_URGENT);
			const rows = db.selectAllLabels();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.name).toBe("urgent");
		});

		it("upsertLabel is idempotent", () => {
			db.upsertLabel(LABEL_URGENT);
			db.upsertLabel({ ...LABEL_URGENT, color: "orange" });
			const rows = db.selectAllLabels();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.color).toBe("orange");
		});

		it("upsertLabel handles labels with null colors", () => {
			db.upsertLabel(LABEL_WORK);
			db.upsertLabel(LABEL_HOME);
			const rows = db.selectAllLabels();
			expect(rows).toHaveLength(2);
			expect(rows.every((l) => l.id === LABEL_IDS.work || l.id === LABEL_IDS.home)).toBe(
				true,
			);
		});
	});

	describe("tasks", () => {
		it("upsertTask inserts a task", () => {
			db.upsertTask(TASK_ALPHA);
			const row = db.selectTaskById(TASK_IDS.alpha);
			expect(row).toMatchObject({
				content: "Alpha task",
				priority: 1,
			});
		});

		it("upsertTask is idempotent", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask({ ...TASK_ALPHA, content: "Updated alpha task" });
			const rows = db.selectTasksByFilters({});
			expect(rows).toHaveLength(1);
			expect(rows[0]?.content).toBe("Updated alpha task");
		});

		it("upsertTask stores labels as JSON and parses on retrieval", () => {
			db.upsertTask(TASK_BETA);
			const row = db.selectTaskById(TASK_IDS.beta);
			expect(row?.labels).toEqual([LABEL_IDS.urgent]);
		});

		it("upsertTask stores tasks with and without sections", () => {
			db.upsertTask(TASK_ALPHA); // has section
			db.upsertTask(TASK_OVERDUE); // section_id is null
			const rows = db.selectTasksByFilters({});
			expect(rows).toHaveLength(2);
		});
	});
});

// ── Query interface tests ────────────────────────────────────────────────

describe("listTasks", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
		db.upsertProject(PROJECT_WORK);
	});

	afterEach(() => {
		db.close();
	});

	it("returns only incomplete tasks by default", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_OVERDUE);
		db.upsertTask(TASK_DONE);
		const results = db.selectTasksByFilters({});
		expect(results).toHaveLength(3);
		expect(results.map((t) => t.id)).toEqual(
			expect.arrayContaining([TASK_IDS.alpha, TASK_IDS.beta, TASK_IDS.overdue]),
		);
		expect(results.map((t) => t.id)).not.toContain(TASK_IDS.done);
	});

	describe("filtering by project", () => {
		it("returns tasks for the specified project", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasksByFilters({ project: PROJECT_IDS.work });
			expect(results).toHaveLength(2);
		});

		it("returns empty array for unknown project", () => {
			db.upsertTask(TASK_ALPHA);
			const results = db.selectTasksByFilters({ project: "proj-unknown" });
			expect(results).toHaveLength(0);
		});
	});

	describe("filtering by due date", () => {
		it("returns only incomplete tasks due today when due=today", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			db.upsertTask(TASK_DONE);
			const results = db.selectTasksByFilters({ due: "today" });
			expect(results).toHaveLength(1);
			expect(results[0]?.id).toBe(TASK_IDS.alpha);
		});

		it("returns only incomplete tasks that are overdue when due=overdue", () => {
			db.upsertTask(TASK_OVERDUE);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasksByFilters({ due: "overdue" });
			expect(results).toHaveLength(1);
			expect(results[0]?.id).toBe(TASK_IDS.overdue);
		});
	});

	describe("filtering by label", () => {
		it("returns only tasks with the specified label", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasksByFilters({ label: LABEL_IDS.urgent });
			expect(results).toHaveLength(1);
			expect(results[0]?.id).toBe(TASK_IDS.beta);
		});

		it("returns empty array for unknown label", () => {
			db.upsertTask(TASK_ALPHA);
			const results = db.selectTasksByFilters({ label: "nonexistent" });
			expect(results).toHaveLength(0);
		});

		it("requires exact label match, no partial matching", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasksByFilters({ label: "urg" });
			expect(results).toHaveLength(0);
		});
	});

	describe("filtering by priority", () => {
		it("returns only tasks with the specified priority", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasksByFilters({ priority: 4 });
			expect(results).toHaveLength(1);
			expect(results[0]?.id).toBe(TASK_IDS.beta);
		});
	});

	describe("pagination", () => {
		it("respects the limit parameter", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			db.upsertTask(TASK_OVERDUE);
			db.upsertTask(TASK_DONE);
			const results = db.selectTasksByFilters({ limit: 2 });
			expect(results).toHaveLength(2);
		});

		it("respects the offset parameter", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			db.upsertTask(TASK_OVERDUE);
			const all = db.selectTasksByFilters({});
			const paged = db.selectTasksByFilters({ offset: 1 });
			expect(paged).toHaveLength(all.length - 1);
			expect(paged[0]?.id).toBe(all[1]?.id);
		});
	});
});

describe("searchTasks", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
		db.upsertProject(PROJECT_WORK);
	});

	afterEach(() => {
		db.close();
	});

	it("returns tasks whose content matches the query", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		const results = db.searchTasksByContent("Alpha");
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe(TASK_IDS.alpha);
	});

	it("performs case-insensitive matching", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(db.searchTasksByContent("alpha")).toHaveLength(1);
		expect(db.searchTasksByContent("ALPHA")).toHaveLength(1);
	});

	it("supports partial string matching in task content", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(db.searchTasksByContent("task")).toHaveLength(2);
	});

	it("excludes completed tasks from search results", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(db.searchTasksByContent("Done")).toHaveLength(0);
	});

	it("returns empty array when no tasks match the query", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(db.searchTasksByContent("zzznomatch")).toHaveLength(0);
	});

	it("handles empty search string gracefully", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		const results = db.searchTasksByContent("");
		expect(Array.isArray(results)).toBe(true);
	});
});

describe("getTask", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
		db.upsertProject(PROJECT_WORK);
	});

	afterEach(() => {
		db.close();
	});

	it("returns the task for a known id", () => {
		db.upsertTask(TASK_ALPHA);
		const result = db.selectTaskById(TASK_IDS.alpha);
		expect(result).not.toBeNull();
		expect(result?.content).toBe("Alpha task");
	});

	it("returns null for an unknown task id", () => {
		const result = db.selectTaskById("task-missing");
		expect(result).toBeNull();
	});

	it("returns task with parsed labels array", () => {
		db.upsertTask(TASK_BETA);
		const result = db.selectTaskById(TASK_IDS.beta);
		expect(result?.labels).toEqual([LABEL_IDS.urgent]);
	});
});

describe("listSections", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
	});

	afterEach(() => {
		db.close();
	});

	it("returns all sections when no project filter given", () => {
		db.upsertProject(PROJECT_WORK);
		db.upsertProject(PROJECT_PERSONAL);
		db.upsertSection(SECTION_BACKLOG);
		db.upsertSection(SECTION_IN_PROGRESS);
		db.upsertSection(SECTION_SOMEDAY);
		const results = listSections(db);
		expect(results).toHaveLength(3);
	});

	it("filters by project id", () => {
		db.upsertProject(PROJECT_WORK);
		db.upsertProject(PROJECT_PERSONAL);
		db.upsertSection(SECTION_BACKLOG);
		db.upsertSection(SECTION_IN_PROGRESS);
		db.upsertSection(SECTION_SOMEDAY);
		const results = listSections(db, PROJECT_IDS.work);
		expect(results).toHaveLength(2);
		expect(results.every((s) => s.projectId === PROJECT_IDS.work)).toBe(true);
	});

	it("returns sections ordered by order_ within a project", () => {
		db.upsertProject(PROJECT_WORK);
		db.upsertSection(SECTION_BACKLOG);
		db.upsertSection(SECTION_IN_PROGRESS);
		const results = listSections(db, PROJECT_IDS.work);
		expect(results[0]?.id).toBe(SECTION_IDS.inProgress); // order_ 1
		expect(results[1]?.id).toBe(SECTION_IDS.backlog); // order_ 2
	});

	it("returns empty array for unknown project", () => {
		const results = listSections(db, "p-unknown");
		expect(results).toHaveLength(0);
	});

	it("returns empty array when no sections exist", () => {
		db.upsertProject(PROJECT_WORK);
		const results = listSections(db, PROJECT_IDS.work);
		expect(results).toHaveLength(0);
	});
});
