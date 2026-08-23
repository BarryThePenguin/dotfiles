import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "./db.ts";
import { driverFactory } from "sqlite-runtime";
import { listSections } from "./operations.ts";
import { getToken, setToken } from "./sync-lifecycle.ts";
import { openDb } from "./test-helpers/database.ts";
import {
	LABEL_HOME,
	LABEL_IDS,
	LABEL_URGENT,
	LABEL_WORK,
	PROJECT_IDS,
	PROJECT_INBOX,
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
	NOTE_ALPHA,
	NOTE_BETA,
	NOTE_IDS,
	NOW,
	makeTask,
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
		const projects = db.selectProjects();
		const sections = db.selectAllSections();
		const labels = db.selectAllLabels();
		expect(projects).toEqual([]);
		expect(sections).toEqual([]);
		expect(labels).toEqual([]);
	});
});

// ── Shared-store pragmas tests ───────────────────────────────────────────

describe("shared-store pragmas", () => {
	it("opens file-backed databases in WAL mode", () => {
		using dir = mkdtempDisposableSync(join(tmpdir(), "doist-db-wal-"));
		const dbPath = join(dir.path, "wal.db");
		const db = new Database({ driver: driverFactory(dbPath) });
		db.close();

		// journal_mode=WAL persists in the file header, so a fresh connection
		// (as another repo's consumer would open) observes it.
		const probe = driverFactory(dbPath);
		try {
			const mode = probe.prepare("PRAGMA journal_mode").get() as {
				journal_mode: string;
			};
			expect(mode.journal_mode).toBe("wal");
		} finally {
			probe.close();
		}
	});

	it("a reader on a second connection is not blocked by an open write", () => {
		using dir = mkdtempDisposableSync(join(tmpdir(), "doist-db-wal-"));
		const dbPath = join(dir.path, "concurrent.db");

		// First connection creates the schema (and WAL mode).
		const setup = new Database({ driver: driverFactory(dbPath) });
		setup.setMeta("probe", "visible");
		setup.close();

		const writer = driverFactory(dbPath);
		const reader = driverFactory(dbPath);
		try {
			writer.exec("BEGIN IMMEDIATE;");
			writer
				.prepare(
					"INSERT INTO meta (key, value) VALUES ('pending', 'write') ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
				)
				.run();

			// In WAL mode this read succeeds while the write transaction above
			// is still uncommitted; in rollback-journal mode it would fail with
			// SQLITE_BUSY.
			const row = reader
				.prepare("SELECT value FROM meta WHERE key = 'probe'")
				.get() as { value: string } | undefined;
			expect(row?.value).toBe("visible");
		} finally {
			writer.exec("ROLLBACK;");
			writer.close();
			reader.close();
		}
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
			const rows = db.selectProjects();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				name: "Inbox",
				isInbox: true,
			});
		});

		it("upsertProject is idempotent — running twice yields one row with updated values", () => {
			db.upsertProject(PROJECT_INBOX);
			db.upsertProject({ ...PROJECT_INBOX, name: "Updated Inbox" });
			const rows = db.selectProjects();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.name).toBe("Updated Inbox");
		});

		it("upsertProject handles multiple projects", () => {
			db.upsertProject(PROJECT_INBOX);
			db.upsertProject(PROJECT_WORK);
			db.upsertProject(PROJECT_PERSONAL);
			const rows = db.selectProjects();
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
			expect(
				rows.every((l) => l.id === LABEL_IDS.work || l.id === LABEL_IDS.home),
			).toBe(true);
		});
	});

	describe("tasks", () => {
		it("upsertTask inserts a task", () => {
			db.upsertTask(TASK_ALPHA);
			const row = db.getTaskById(TASK_IDS.alpha);
			expect(row).toMatchObject({
				content: "Alpha task",
				priority: 1,
			});
		});

		it("upsertTask is idempotent", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask({ ...TASK_ALPHA, content: "Updated alpha task" });
			const rows = db.selectTasks();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.content).toBe("Updated alpha task");
		});

		it("upsertTask preserves task metadata fields on retrieval", () => {
			db.upsertTask(TASK_BETA);
			const row = db.getTaskById(TASK_IDS.beta);
			expect(row?.labels).toEqual([LABEL_IDS.urgent]);
		});

		it("upsertTask stores tasks with and without sections", () => {
			db.upsertTask(TASK_ALPHA); // has section
			db.upsertTask(TASK_OVERDUE); // section_id is null
			const rows = db.selectTasks();
			expect(rows).toHaveLength(2);
		});

		it("upsertTask stores labels as JSON and parses on retrieval", () => {
			db.upsertTask(TASK_BETA);
			const row = db.getTaskById(TASK_IDS.beta);
			expect(row?.labels).toEqual([LABEL_IDS.urgent]);
			expect(row).toMatchObject({
				parentId: null,
				childOrder: 2,
				noteCount: 1,
				updatedAt: expect.any(String) as unknown,
			});
		});
	});

	describe("notes", () => {
		it("upsertNote inserts a note", () => {
			db.upsertNote(NOTE_ALPHA);
			const notes = db.selectNotesByTask("t1");
			expect(notes).toHaveLength(1);
			expect(notes[0]).toMatchObject({
				id: NOTE_IDS.alpha,
				itemId: "t1",
				content: "Resolution: alpha",
			});
		});

		it("upsertNote is idempotent", () => {
			db.upsertNote(NOTE_ALPHA);
			db.upsertNote({ ...NOTE_ALPHA, content: "Updated resolution" });
			const notes = db.selectNotesByTask("t1");
			expect(notes).toHaveLength(1);
			expect(notes[0]?.content).toBe("Updated resolution");
		});

		it("selectNotesByTask filters by item_id", () => {
			db.upsertNote(NOTE_ALPHA); // t1
			db.upsertNote(NOTE_BETA); // t2
			const t1 = db.selectNotesByTask("t1");
			const t2 = db.selectNotesByTask("t2");
			expect(t1.map((n) => n.id)).toEqual([NOTE_IDS.alpha]);
			expect(t2.map((n) => n.id)).toEqual([NOTE_IDS.beta]);
		});

		it("selectNotesByTask returns empty for unknown task", () => {
			db.upsertNote(NOTE_ALPHA);
			expect(db.selectNotesByTask("nope")).toEqual([]);
		});

		it("selectNotesByTask skips soft-deleted notes (is_deleted=1)", () => {
			db.upsertNote(NOTE_ALPHA);
			db.upsertNote({ ...NOTE_BETA, item_id: "t1", is_deleted: 1 });
			const notes = db.selectNotesByTask("t1");
			expect(notes).toHaveLength(1);
			expect(notes[0]?.id).toBe(NOTE_IDS.alpha);
		});

		it("deleteNotesByIds removes notes", () => {
			db.upsertNote(NOTE_ALPHA);
			db.upsertNote(NOTE_BETA);
			db.deleteNotesByIds([NOTE_IDS.alpha]);
			expect(db.selectNotesByTask("t1")).toEqual([]);
			expect(db.selectNotesByTask("t2")).toHaveLength(1);
		});

		it("deleteNotesByIds is a no-op on empty input", () => {
			db.upsertNote(NOTE_ALPHA);
			db.deleteNotesByIds([]);
			expect(db.selectNotesByTask("t1")).toHaveLength(1);
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
		const results = db.selectTasks();
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
			const results = db.selectTasks({ projectId: PROJECT_IDS.work });
			expect(results).toHaveLength(2);
		});

		it("returns empty array for unknown project", () => {
			db.upsertTask(TASK_ALPHA);
			const results = db.selectTasks({ projectId: "proj-unknown" });
			expect(results).toHaveLength(0);
		});
	});

	describe("filtering by due date", () => {
		it("returns only incomplete tasks due today when due=today", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			db.upsertTask(TASK_DONE);
			const results = db.selectTasks({ due: "today" });
			expect(results).toHaveLength(1);
			expect(results[0]?.id).toBe(TASK_IDS.alpha);
		});

		it("returns only incomplete tasks that are overdue when due=overdue", () => {
			db.upsertTask(TASK_OVERDUE);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasks({ due: "overdue" });
			expect(results).toHaveLength(1);
			expect(results[0]?.id).toBe(TASK_IDS.overdue);
		});
	});

	describe("filtering by label", () => {
		it("returns only tasks with the specified label", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasks({ label: LABEL_IDS.urgent });
			expect(results).toHaveLength(1);
			expect(results[0]?.id).toBe(TASK_IDS.beta);
		});

		it("returns empty array for unknown label", () => {
			db.upsertTask(TASK_ALPHA);
			const results = db.selectTasks({ label: "nonexistent" });
			expect(results).toHaveLength(0);
		});

		it("requires exact label match, no partial matching", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasks({ label: "urg" });
			expect(results).toHaveLength(0);
		});
	});

	describe("filtering by priority", () => {
		it("returns only tasks with the specified priority", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			const results = db.selectTasks({ priority: 4 });
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
			const results = db.selectTasks({ limit: 2 });
			expect(results).toHaveLength(2);
		});

		it("respects the offset parameter", () => {
			db.upsertTask(TASK_ALPHA);
			db.upsertTask(TASK_BETA);
			db.upsertTask(TASK_OVERDUE);
			const all = db.selectTasks();
			const paged = db.selectTasks({ offset: 1 });
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
		const results = db.selectTasks({
			content: "Alpha",
			completed: "incomplete",
			orderBy: { field: "priority", direction: "desc" },
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe(TASK_IDS.alpha);
	});

	it("performs case-insensitive matching", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(
			db.selectTasks({
				content: "alpha",
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
			}),
		).toHaveLength(1);
		expect(
			db.selectTasks({
				content: "ALPHA",
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
			}),
		).toHaveLength(1);
	});

	it("supports partial string matching in task content", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(
			db.selectTasks({
				content: "task",
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
			}),
		).toHaveLength(2);
	});

	it("excludes completed tasks from search results", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(
			db.selectTasks({
				content: "Done",
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
			}),
		).toHaveLength(0);
	});

	it("returns empty array when no tasks match the query", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		db.upsertTask(TASK_DONE);
		expect(
			db.selectTasks({
				content: "zzznomatch",
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
			}),
		).toHaveLength(0);
	});

	it("handles empty search string gracefully", () => {
		db.upsertTask(TASK_ALPHA);
		db.upsertTask(TASK_BETA);
		const results = db.selectTasks({
			content: "",
			completed: "incomplete",
			orderBy: { field: "priority", direction: "desc" },
		});
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
		const result = db.getTaskById(TASK_IDS.alpha);
		expect(result).not.toBeNull();
		expect(result?.content).toBe("Alpha task");
	});

	it("returns null for an unknown task id", () => {
		const result = db.getTaskById("task-missing");
		expect(result).toBeNull();
	});

	it("returns task with parsed labels array", () => {
		db.upsertTask(TASK_BETA);
		const result = db.getTaskById(TASK_IDS.beta);
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

// ── Filter CRUD tests ────────────────────────────────────────────────

describe("filter operations", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
	});

	afterEach(() => {
		db.close();
	});

	const FILTER_A = {
		id: "f1",
		name: "Today",
		query: "today",
		color: "blue",
		item_order: 1,
		is_favorite: 0,
		synced_at: NOW,
	};

	const FILTER_B = {
		id: "f2",
		name: "Triage",
		query: "overdue | today",
		color: "red",
		item_order: 2,
		is_favorite: 1,
		synced_at: NOW,
	};

	it("upsertFilter and selectFilters round-trips a filter", () => {
		db.upsertFilter(FILTER_A);
		const filters = db.selectFilters();
		expect(filters).toHaveLength(1);
		expect(filters[0]?.id).toBe("f1");
		expect(filters[0]?.name).toBe("Today");
		expect(filters[0]?.query).toBe("today");
		expect(filters[0]?.color).toBe("blue");
		expect(filters[0]?.itemOrder).toBe(1);
		expect(filters[0]?.isFavorite).toBe(false);
	});

	it("selectFilters orders by item_order", () => {
		db.upsertFilter(FILTER_B);
		db.upsertFilter(FILTER_A);
		const filters = db.selectFilters();
		expect(filters[0]?.id).toBe("f1"); // item_order 1
		expect(filters[1]?.id).toBe("f2"); // item_order 2
	});

	it("upsertFilter overwrites on conflict", () => {
		db.upsertFilter(FILTER_A);
		db.upsertFilter({ ...FILTER_A, name: "Renamed" });
		const filters = db.selectFilters();
		expect(filters).toHaveLength(1);
		expect(filters[0]?.name).toBe("Renamed");
	});

	it("getFilterById returns the matching filter", () => {
		db.upsertFilter(FILTER_A);
		db.upsertFilter(FILTER_B);
		const filter = db.getFilterById("f2");
		expect(filter?.name).toBe("Triage");
	});

	it("getFilterById returns null for unknown id", () => {
		expect(db.getFilterById("f-unknown")).toBeNull();
	});

	it("getFilterByName returns the matching filter", () => {
		db.upsertFilter(FILTER_A);
		const filter = db.getFilterByName("Today");
		expect(filter?.id).toBe("f1");
	});

	it("getFilterByName returns null for unknown name", () => {
		expect(db.getFilterByName("Nonexistent")).toBeNull();
	});

	it("deleteFilterById removes the filter", () => {
		db.upsertFilter(FILTER_A);
		db.upsertFilter(FILTER_B);
		db.deleteFilterById("f1");
		const filters = db.selectFilters();
		expect(filters).toHaveLength(1);
		expect(filters[0]?.id).toBe("f2");
	});

	it("deleteFilterById is a no-op for unknown id", () => {
		db.upsertFilter(FILTER_A);
		db.deleteFilterById("f-unknown");
		expect(db.selectFilters()).toHaveLength(1);
	});

	it("selectFilters returns empty array when no filters exist", () => {
		expect(db.selectFilters()).toEqual([]);
	});
});

// ── Read-time project lens tests ────────────────────────────────────────────
// The write path still filters to allowed projects; these tests only exercise
// the read-side scope that will keep reads correct once writes stop filtering.

describe("read-time project lens", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
		db.upsertProject(PROJECT_WORK);
		db.upsertProject(PROJECT_PERSONAL);
		db.upsertSection(SECTION_BACKLOG); // work
		db.upsertSection(SECTION_SOMEDAY); // personal
		db.upsertTask(TASK_ALPHA); // work
		db.upsertTask(TASK_BETA); // work
		db.upsertTask({ ...makeTask("t-personal-1", PROJECT_IDS.personal) });
		db.upsertTask({ ...makeTask("t-personal-2", PROJECT_IDS.personal) });
	});

	afterEach(() => {
		db.close();
	});

	it("returns all stored tasks when no scope is set", () => {
		const results = db.selectTasks();
		expect(results.map((t) => t.id)).toEqual(
			expect.arrayContaining([
				TASK_IDS.alpha,
				TASK_IDS.beta,
				"t-personal-1",
				"t-personal-2",
			]),
		);
	});

	it("scopes tasks to a single project by id", () => {
		const results = db.selectTasks({ projectScope: [PROJECT_IDS.work] });
		expect(results.map((t) => t.id).sort()).toEqual(
			[TASK_IDS.alpha, TASK_IDS.beta].sort(),
		);
	});

	it("scopes tasks to a single project by name", () => {
		const results = db.selectTasks({ projectScope: ["Personal"] });
		expect(results.map((t) => t.id).sort()).toEqual(
			["t-personal-1", "t-personal-2"].sort(),
		);
	});

	it("scopes tasks to multiple projects", () => {
		const results = db.selectTasks({
			projectScope: [PROJECT_IDS.work, PROJECT_IDS.personal],
		});
		expect(results).toHaveLength(4);
	});

	it("returns no tasks for a scope with no stored match", () => {
		const results = db.selectTasks({ projectScope: ["nonexistent"] });
		expect(results).toEqual([]);
	});

	it("combines the scope with other filters", () => {
		const results = db.selectTasks({
			projectScope: [PROJECT_IDS.work],
			priority: 4,
		});
		expect(results.map((t) => t.id)).toEqual([TASK_IDS.beta]);
	});

	it("scopes projects to the lens", () => {
		const results = db.selectProjects(undefined, [PROJECT_IDS.personal]);
		expect(results.map((p) => p.id)).toEqual([PROJECT_IDS.personal]);
	});

	it("scopes sections to the lens", () => {
		const results = db.selectSections(undefined, [PROJECT_IDS.personal]);
		expect(results.map((s) => s.id)).toEqual([SECTION_IDS.someday]);
	});

	it("leaves unscoped project reads unchanged", () => {
		const results = db.selectProjects();
		expect(results.map((p) => p.id).sort()).toEqual(
			[PROJECT_IDS.work, PROJECT_IDS.personal].sort(),
		);
	});
});
