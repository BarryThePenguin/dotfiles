import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultHarness } from "../test-helpers/server.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

async function tasksList(args: Record<string, unknown> = {}) {
	return (await harness.client.callTool("todoist_tasks_list", args)) as {
		syncedAt: string | null;
		tasks: Array<Record<string, unknown>>;
	};
}

describe("tasks_list", () => {
	it("returns all incomplete tasks", async () => {
		const { tasks } = await tasksList();
		expect(tasks).toHaveLength(2);
		expect(tasks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "t1", content: "Alpha task" }),
				expect.objectContaining({ id: "t2", content: "Beta task" }),
			]),
		);
	});

	it("returns full task details when requested", async () => {
		const { tasks } = await tasksList({ details: true });
		expect(typeof tasks[0]?.["content"]).toBe("string");
		expect(Array.isArray(tasks[0]?.["labels"])).toBe(true);
		expect(typeof tasks[0]?.["priority"]).toBe("number");
		expect(tasks[0]).toMatchObject({ description: null });
	});

	it("includes syncedAt in the response", async () => {
		const { syncedAt } = await tasksList();
		expect(syncedAt).toEqual(expect.any(String));
	});

	it("filters by project", async () => {
		const { tasks } = await tasksList({ project: "p1" });
		expect(tasks).toHaveLength(2);
	});

	it("filters by due=today", async () => {
		const { tasks } = await tasksList({ due: "today" });
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({ id: "t1" });
	});

	it("filters by priority", async () => {
		const { tasks } = await tasksList({ priority: 4 });
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({ id: "t2" });
	});

	it("filters by label", async () => {
		const { tasks } = await tasksList({ label: "urgent" });
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({ id: "t1" });
	});

	it("returns empty for unknown project", async () => {
		const { tasks } = await tasksList({ project: "unknown" });
		expect(tasks).toHaveLength(0);
	});

	it("filters by project name as well as id", async () => {
		const { tasks } = await tasksList({ project: "Work" });
		expect(tasks).toHaveLength(2);
	});
});

describe("tasks_search", () => {
	it("returns matching tasks as formatted objects", async () => {
		const result = (await harness.client.callTool("todoist_tasks_search", {
			query: "Alpha",
		})) as { tasks: Array<Record<string, unknown>> };
		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0]).toMatchObject({ id: "t1", content: "Alpha task" });
	});

	it("returns empty for no match", async () => {
		const result = (await harness.client.callTool("todoist_tasks_search", {
			query: "missing",
		})) as { tasks: Array<Record<string, unknown>> };
		expect(result.tasks).toHaveLength(0);
	});
});

describe("tasks_complete", () => {
	it("calls completeTasks and marks the row done in the db", async () => {
		const result = (await harness.client.callTool("todoist_tasks_complete", {
			id: "t1",
		})) as { ok: boolean; completed: number };
		expect(result).toMatchObject({ ok: true, completed: 1 });
		expect(harness.container.db.getTaskById("t1")?.isCompleted).toBe(true);
	});
});

describe("tasks_uncomplete", () => {
	it("reopens a completed task", async () => {
		await harness.client.callTool("todoist_tasks_complete", {
			id: "t1",
		});
		const result = (await harness.client.callTool("todoist_tasks_uncomplete", {
			id: "t1",
		})) as { ok: boolean; reopened: number };
		expect(result).toMatchObject({ ok: true, reopened: 1 });
		expect(harness.container.db.getTaskById("t1")?.isCompleted).toBe(false);
	});
});

describe("tasks_update", () => {
	it("updates task title", async () => {
		const result = (await harness.client.callTool("todoist_tasks_update", {
			id: "t1",
			title: "Alpha task updated",
		})) as Record<string, unknown>;
		expect(result).toMatchObject({ content: "Alpha task updated" });
	});

	it("appends a new label to existing labels", async () => {
		await harness.client.callTool("todoist_tasks_update", {
			id: "t1",
			addLabels: ["new"],
		});
		expect(harness.container.db.getTaskById("t1")?.labels).toEqual([
			"urgent",
			"new",
		]);
	});

	it("does not duplicate an existing label", async () => {
		await harness.client.callTool("todoist_tasks_update", {
			id: "t1",
			addLabels: ["urgent"],
		});
		expect(harness.container.db.getTaskById("t1")?.labels).toEqual(["urgent"]);
	});

	it("passes sectionId when section is provided", async () => {
		await harness.client.callTool("todoist_tasks_update", {
			id: "t2",
			section: "Backlog",
		});
		expect(harness.container.db.getTaskById("t2")?.sectionId).toBe("Backlog");
	});
});

describe("tasks_move", () => {
	it("moves a task to another project", async () => {
		await harness.client.callTool("todoist_tasks_move", {
			id: "t1",
			project: "Personal",
		});
		expect(harness.container.db.getTaskById("t1")?.projectId).toBe("p2");
	});
});

describe("tasks_add", () => {
	it("creates a new task", async () => {
		const result = (await harness.client.callTool("todoist_tasks_add", {
			title: "New task",
			project: "p1",
		})) as Record<string, unknown>;
		expect(result).toMatchObject({ content: "New task" });
	});

	it("resolves project by name when a name is passed to 'project'", async () => {
		await harness.client.callTool("todoist_tasks_add", {
			title: "Named project task",
			project: "Work",
		});
		expect(harness.container.client.sync).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				type: "item_add",
				args: expect.objectContaining({ project_id: "p1" }) as unknown,
			}),
		);
	});

	it("passes project as-is when it does not match any project name", async () => {
		await harness.client.callTool("todoist_tasks_add", {
			title: "Literal project task",
			project: "literal-id",
		});
		expect(harness.container.client.sync).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				type: "item_add",
				args: expect.objectContaining({ project_id: "literal-id" }) as unknown,
			}),
		);
	});

	it("passes sectionId when section is provided", async () => {
		await harness.client.callTool("todoist_tasks_add", {
			title: "Sectioned task",
			section: "Backlog",
		});
		expect(harness.container.client.sync).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				type: "item_add",
				args: expect.objectContaining({ section_id: "Backlog" }) as unknown,
			}),
		);
	});

	it("passes parentId when provided", async () => {
		await harness.client.callTool("todoist_tasks_add", {
			title: "Subtask",
			parentId: "parent-task-id",
		});
		expect(harness.container.client.sync).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				type: "item_add",
				args: expect.objectContaining({ parent_id: "parent-task-id" }) as unknown,
			}),
		);
	});
});
