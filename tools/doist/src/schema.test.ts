/**
 * Unit tests for Todoist API schema transformations.
 *
 * Tests the prepare/normalize functions that translate between:
 * - Todoist API types → Database types → Application types
 * - User mutation types → Todoist API request args
 */

import { describe, expect, it } from "vitest";
import type { DbLabel, DbProject, DbSection, DbTask } from "./db.ts";
import {
	normalizeLabel,
	normalizeProject,
	normalizeSection,
	normalizeTask,
	prepareLabelForDB,
	prepareProjectForDB,
	prepareSectionForDB,
	prepareTaskForDB,
} from "./schema.ts";
import type { SyncItem, SyncLabel, SyncProject, SyncSection } from "./sdk.ts";
import { encodeAddFields, encodeUpdateFields } from "./sdk.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function syncItem(overrides: Partial<SyncItem> = {}): SyncItem {
	return {
		id: "t1",
		project_id: "p1",
		section_id: "s1",
		content: "Task content",
		description: "Task description",
		priority: 2,
		due: { date: "2026-05-24", string: "May 24", is_recurring: false },
		labels: ["urgent", "work"],
		checked: false,
		added_at: "2026-05-23T10:00:00Z",
		updated_at: "2026-05-23T11:00:00Z",
		child_order: 1,
		is_deleted: false,
		...overrides,
	};
}

function dbTask(overrides: Partial<DbTask> = {}): DbTask {
	return {
		id: "t1",
		project_id: "p1",
		section_id: "s1",
		parent_id: null,
		child_order: 1,
		note_count: 0,
		updated_at: "2026-05-23T11:00:00Z",
		content: "Task content",
		description: "Task description",
		priority: 2,
		due_date: "2026-05-24",
		due_string: "May 24",
		labels: JSON.stringify(["urgent", "work"]),
		is_completed: 0,
		is_recurring: 0,
		created_at: "2026-05-23T10:00:00Z",
		synced_at: "2026-05-23T12:00:00Z",
		...overrides,
	};
}

// ── prepareTaskForDB ──────────────────────────────────────────────────────

describe("prepareTaskForDB", () => {
	it("converts SyncItem to DbTask with correct field mappings", () => {
		const item = syncItem();
		const task = prepareTaskForDB(item);

		expect(task.id).toBe("t1");
		expect(task.project_id).toBe("p1");
		expect(task.section_id).toBe("s1");
		expect(task.content).toBe("Task content");
		expect(task.description).toBe("Task description");
		expect(task.priority).toBe(2);
		expect(task.due_date).toBe("2026-05-24");
		expect(task.due_string).toBe("May 24");
		expect(task.labels).toBe(JSON.stringify(["urgent", "work"]));
		expect(task.is_completed).toBe(0);
		expect(task.created_at).toBe("2026-05-23T10:00:00Z");
		expect(task.updated_at).toBe("2026-05-23T11:00:00Z");
		expect(task.parent_id).toBeNull();
		expect(task.note_count).toBe(0);
		expect(task.child_order).toBe(1);
		expect(typeof task.synced_at).toBe("string");
	});

	it("converts checked=true to is_completed=1", () => {
		const item = syncItem({ checked: true });
		const task = prepareTaskForDB(item);
		expect(task.is_completed).toBe(1);
	});

	it("handles null added_at by storing null created_at", () => {
		const item = syncItem({ added_at: null });
		const task = prepareTaskForDB(item);
		expect(task.created_at).toBeNull();
	});

	it("handles null due by storing null for both due_date and due_string", () => {
		const item = syncItem({ due: null });
		const task = prepareTaskForDB(item);
		expect(task.due_date).toBeNull();
		expect(task.due_string).toBeNull();
	});

	it("handles null section_id", () => {
		const item = syncItem({ section_id: null });
		const task = prepareTaskForDB(item);
		expect(task.section_id).toBeNull();
	});

	it("stringifies labels array", () => {
		const item = syncItem({ labels: ["a", "b", "c"] });
		const task = prepareTaskForDB(item);
		expect(task.labels).toBe(JSON.stringify(["a", "b", "c"]));
	});
});

// ── normalizeTask ──────────────────────────────────────────────────────────

describe("normalizeTask", () => {
	it("converts DbTask to AppTask with camelCase fields", () => {
		const task = dbTask();
		const normalized = normalizeTask(task);

		expect(normalized.id).toBe("t1");
		expect(normalized.url).toBe("https://app.todoist.com/app/task/t1");
		expect(normalized.projectId).toBe("p1");
		expect(normalized.sectionId).toBe("s1");
		expect(normalized.content).toBe("Task content");
		expect(normalized.description).toBe("Task description");
		expect(normalized.priority).toBe(2);
		expect(normalized.due).toEqual({
			date: "2026-05-24",
			string: "May 24",
			isRecurring: false,
		});
		expect(normalized.labels).toEqual(["urgent", "work"]);
		expect(normalized.isCompleted).toBe(false);
		expect(normalized.createdAt).toBe("2026-05-23T10:00:00Z");
		expect(normalized.updatedAt).toBe("2026-05-23T11:00:00Z");
		expect(normalized.parentId).toBeNull();
		expect(normalized.noteCount).toBe(0);
		expect(normalized.childOrder).toBe(1);
	});

	it("converts is_completed=1 to completed=true", () => {
		const task = dbTask({ is_completed: 1 });
		const normalized = normalizeTask(task);
		expect(normalized.isCompleted).toBe(true);
	});

	it("handles null due fields", () => {
		const task = dbTask({ due_date: null, due_string: null });
		const normalized = normalizeTask(task);
		expect(normalized.due).toBeNull();
	});

	it("handles null section_id", () => {
		const task = dbTask({ section_id: null });
		const normalized = normalizeTask(task);
		expect(normalized.sectionId).toBeNull();
	});

	it("parses labels from JSON string", () => {
		const task = dbTask({ labels: JSON.stringify(["a", "b", "c"]) });
		const normalized = normalizeTask(task);
		expect(normalized.labels).toEqual(["a", "b", "c"]);
	});

	it("handles empty labels array", () => {
		const task = dbTask({ labels: "[]" });
		const normalized = normalizeTask(task);
		expect(normalized.labels).toEqual([]);
	});
});

// ── prepareProjectForDB ────────────────────────────────────────────────────

describe("prepareProjectForDB", () => {
	it("converts project to DbProject with field name changes", () => {
		const project: SyncProject = {
			id: "p1",
			name: "Work",
			color: "blue",
			is_favorite: true,
			inbox_project: false,
			is_deleted: false,
			is_archived: false,
		};
		const decoded = prepareProjectForDB(project);

		expect(decoded).not.toBeNull();
		expect(decoded?.id).toBe("p1");
		expect(decoded?.name).toBe("Work");
		expect(decoded?.color).toBe("blue");
		expect(decoded?.is_favorite).toBe(1);
		expect(decoded?.is_inbox).toBe(0);
		expect(typeof decoded?.synced_at).toBe("string");
	});

	it("returns null for deleted projects", () => {
		const project: SyncProject = {
			id: "p1",
			name: "Deleted",
			color: "blue",
			is_deleted: true,
			is_archived: false,
			is_favorite: false,
		};
		const decoded = prepareProjectForDB(project);
		expect(decoded).toBeNull();
	});

	it("returns null for archived projects", () => {
		const project: SyncProject = {
			id: "p1",
			name: "Archived",
			color: "blue",
			is_deleted: false,
			is_archived: true,
			is_favorite: false,
		};
		const decoded = prepareProjectForDB(project);
		expect(decoded).toBeNull();
	});

	it("converts boolean flags to 0/1", () => {
		const project: SyncProject = {
			id: "p1",
			name: "Test",
			color: "red",
			is_favorite: true,
			inbox_project: true,
			is_deleted: false,
			is_archived: false,
		};
		const decoded = prepareProjectForDB(project);

		expect(decoded?.is_favorite).toBe(1);
		expect(decoded?.is_inbox).toBe(1);
	});
});

// ── normalizeProject ───────────────────────────────────────────────────────

describe("normalizeProject", () => {
	it("converts DbProject to AppProject with camelCase", () => {
		const project: DbProject = {
			id: "p1",
			name: "Work",
			color: "blue",
			is_favorite: 1,
			is_inbox: 0,
			synced_at: "2026-05-23T12:00:00Z",
		};
		const normalized = normalizeProject(project);

		expect(normalized.id).toBe("p1");
		expect(normalized.name).toBe("Work");
		expect(normalized.color).toBe("blue");
		expect(normalized.isFavorite).toBe(true);
		expect(normalized.isInbox).toBe(false);
	});

	it("converts is_favorite 0 to false", () => {
		const project: DbProject = {
			id: "p1",
			name: "Test",
			color: "red",
			is_favorite: 0,
			is_inbox: 1,
			synced_at: "2026-05-23T12:00:00Z",
		};
		const normalized = normalizeProject(project);

		expect(normalized.isFavorite).toBe(false);
		expect(normalized.isInbox).toBe(true);
	});
});

// ── prepareSectionForDB ────────────────────────────────────────────────────

describe("prepareSectionForDB", () => {
	it("converts section to DbSection with correct field names", () => {
		const section: SyncSection = {
			id: "s1",
			project_id: "p1",
			name: "Todo",
			section_order: 1,
			is_deleted: false,
			is_archived: false,
		};
		const decoded = prepareSectionForDB(section);

		expect(decoded).not.toBeNull();
		expect(decoded?.id).toBe("s1");
		expect(decoded?.project_id).toBe("p1");
		expect(decoded?.name).toBe("Todo");
		expect(decoded?.section_order).toBe(1);
		expect(typeof decoded?.synced_at).toBe("string");
	});

	it("returns null for deleted sections", () => {
		const section: SyncSection = {
			id: "s1",
			project_id: "p1",
			name: "Deleted",
			section_order: 0,
			is_deleted: true,
			is_archived: false,
		};
		const decoded = prepareSectionForDB(section);
		expect(decoded).toBeNull();
	});

	it("returns null for archived sections", () => {
		const section: SyncSection = {
			id: "s1",
			project_id: "p1",
			name: "Archived",
			section_order: 0,
			is_deleted: false,
			is_archived: true,
		};
		const decoded = prepareSectionForDB(section);
		expect(decoded).toBeNull();
	});
});

// ── normalizeSection ───────────────────────────────────────────────────────

describe("normalizeSection", () => {
	it("converts DbSection to AppSection with camelCase", () => {
		const section: DbSection = {
			id: "s1",
			project_id: "p1",
			name: "Todo",
			section_order: 1,
			synced_at: "2026-05-23T12:00:00Z",
		};
		const normalized = normalizeSection(section);

		expect(normalized.id).toBe("s1");
		expect(normalized.projectId).toBe("p1");
		expect(normalized.name).toBe("Todo");
		expect(normalized.sectionOrder).toBe(1);
	});
});

// ── prepareLabelForDB ──────────────────────────────────────────────────────

describe("prepareLabelForDB", () => {
	it("converts label to DbLabel", () => {
		const label: SyncLabel = {
			id: "l1",
			name: "urgent",
			color: "red",
			is_deleted: false,
		};
		const decoded = prepareLabelForDB(label);

		expect(decoded).not.toBeNull();
		expect(decoded?.id).toBe("l1");
		expect(decoded?.name).toBe("urgent");
		expect(decoded?.color).toBe("red");
		expect(typeof decoded?.synced_at).toBe("string");
	});

	it("returns null for deleted labels", () => {
		const label: SyncLabel = {
			id: "l1",
			name: "deleted",
			color: "gray",
			is_deleted: true,
		};
		const decoded = prepareLabelForDB(label);
		expect(decoded).toBeNull();
	});
});

// ── normalizeLabel ────────────────────────────────────────────────────────

describe("normalizeLabel", () => {
	it("converts DbLabel to AppLabel with camelCase", () => {
		const label: DbLabel = {
			id: "l1",
			name: "urgent",
			color: "red",
			synced_at: "2026-05-23T12:00:00Z",
		};
		const normalized = normalizeLabel(label);

		expect(normalized.id).toBe("l1");
		expect(normalized.name).toBe("urgent");
		expect(normalized.color).toBe("red");
	});
});

// ── encodeUpdateFields ─────────────────────────────────────────────────────

describe("encodeUpdateFields", () => {
	it("converts title to content", () => {
		const fields = { title: "New title" };
		const encoded = encodeUpdateFields(fields, "t1");
		expect(encoded.content).toBe("New title");
	});

	it("converts due to { string }", () => {
		const fields = { due: "2026-05-24" };
		const encoded = encodeUpdateFields(fields, "t1");
		expect(encoded.due).toEqual({ string: "2026-05-24" });
	});

	it("converts sectionId to section_id", () => {
		const fields = { sectionId: "s1" };
		const encoded = encodeUpdateFields(fields, "t1");
		expect(encoded.section_id).toBe("s1");
	});

	it("includes priority unchanged", () => {
		const fields = { priority: 4 };
		const encoded = encodeUpdateFields(fields, "t1");
		expect(encoded.priority).toBe(4);
	});

	it("includes description unchanged", () => {
		const fields = { description: "New description" };
		const encoded = encodeUpdateFields(fields, "t1");
		expect(encoded.description).toBe("New description");
	});

	it("includes labels unchanged", () => {
		const fields = { labels: ["urgent", "work"] };
		const encoded = encodeUpdateFields(fields, "t1");
		expect(encoded.labels).toEqual(["urgent", "work"]);
	});

	it("omits undefined fields", () => {
		const fields = { title: "Title" };
		const encoded = encodeUpdateFields(fields, "t1");
		expect(Object.keys(encoded).sort()).toEqual(["content", "id"]);
	});

	it("includes multiple fields together", () => {
		const fields = {
			title: "Updated",
			priority: 3,
			due: "2026-05-25",
			labels: ["work"],
		};
		const encoded = encodeUpdateFields(fields, "t1");
		expect(encoded).toEqual({
			id: "t1",
			content: "Updated",
			priority: 3,
			due: { string: "2026-05-25" },
			labels: ["work"],
		});
	});
});

// ── encodeAddFields ────────────────────────────────────────────────────────

describe("encodeAddFields", () => {
	it("converts title to content (required)", () => {
		const fields = { title: "New task" };
		const encoded = encodeAddFields(fields);
		expect(encoded.content).toBe("New task");
	});

	it("converts projectId to project_id", () => {
		const fields = { title: "Task", projectId: "p1" };
		const encoded = encodeAddFields(fields);
		expect(encoded.project_id).toBe("p1");
	});

	it("converts sectionId to section_id", () => {
		const fields = { title: "Task", sectionId: "s1" };
		const encoded = encodeAddFields(fields);
		expect(encoded.section_id).toBe("s1");
	});

	it("converts due to { string }", () => {
		const fields = { title: "Task", due: "2026-05-24" };
		const encoded = encodeAddFields(fields);
		expect(encoded.due).toEqual({ string: "2026-05-24" });
	});

	it("includes priority and labels unchanged", () => {
		const fields = {
			title: "Task",
			priority: 2,
			labels: ["work"],
		};
		const encoded = encodeAddFields(fields);
		expect(encoded.priority).toBe(2);
		expect(encoded.labels).toEqual(["work"]);
	});

	it("omits undefined optional fields", () => {
		const fields = { title: "Task" };
		const encoded = encodeAddFields(fields);
		expect(Object.keys(encoded)).toEqual(["content"]);
	});

	it("includes all fields when provided", () => {
		const fields = {
			title: "New task",
			projectId: "p1",
			sectionId: "s1",
			priority: 3,
			due: "2026-05-24",
			labels: ["urgent"],
		};
		const encoded = encodeAddFields(fields);
		expect(encoded).toEqual({
			content: "New task",
			project_id: "p1",
			section_id: "s1",
			priority: 3,
			due: { string: "2026-05-24" },
			labels: ["urgent"],
		});
	});
});
