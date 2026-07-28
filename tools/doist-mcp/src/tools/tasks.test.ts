import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "doist-core";
import { createDefaultHarness } from "../test-helpers/server.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

describe("tasks_list", () => {
	it("returns all incomplete tasks", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
		});
		expect(structuredContent).toHaveProperty("tasks", [
			{ id: "t1", content: "Alpha task" },
			{ id: "t2", content: "Beta task" },
		]);
	});

	it("returns full task details when requested", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
			arguments: { details: true },
		});

		expect(structuredContent).toHaveProperty(
			"tasks",
			expect.arrayContaining([
				expect.objectContaining({
					id: "t1",
					priority: 1,
					labels: ["urgent"],
					description: null,
				}),
			]),
		);
	});

	it("includes syncedAt in the response", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
		});
		expect(structuredContent).toHaveProperty("syncedAt", expect.any(String));
	});

	it("filters by project", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
			arguments: { project: "p1" },
		});
		expect(structuredContent).toHaveProperty("tasks", [
			{ id: "t1", content: "Alpha task" },
			{ id: "t2", content: "Beta task" },
		]);
	});

	it("filters by due=today", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
			arguments: { due: "today" },
		});
		expect(structuredContent).toHaveProperty("tasks", [
			{ id: "t1", content: "Alpha task" },
		]);
	});

	it("filters by priority", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
			arguments: { priority: 4 },
		});
		expect(structuredContent).toHaveProperty("tasks", [
			{ id: "t2", content: "Beta task" },
		]);
	});

	it("filters by label", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
			arguments: { label: "urgent" },
		});
		expect(structuredContent).toHaveProperty("tasks", [
			{ id: "t1", content: "Alpha task" },
		]);
	});

	it("returns empty for unknown project", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
			arguments: { project: "unknown" },
		});
		expect(structuredContent).toHaveProperty("tasks", []);
	});

	it("filters by project name as well as id", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_list",
			arguments: { project: "Work" },
		});
		expect(structuredContent).toHaveProperty("tasks", [
			{ id: "t1", content: "Alpha task" },
			{ id: "t2", content: "Beta task" },
		]);
	});
});

describe("tasks_search", () => {
	it("returns matching tasks as formatted objects", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_search",
			arguments: {
				query: "Alpha",
			},
		});
		expect(structuredContent).toHaveProperty("tasks", [
			expect.objectContaining({ id: "t1", content: "Alpha task" }),
		]);
	});

	it("returns empty for no match", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_search",
			arguments: {
				query: "missing",
			},
		});
		expect(structuredContent).toHaveProperty("tasks", []);
	});
});

describe("tasks_complete", () => {
	it("calls completeTasks and marks the row done in the db", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_complete",
			arguments: {
				id: "t1",
			},
		});
		expect(structuredContent).toMatchObject({ ok: true, completed: 1 });
		expect(harness.container.db.getTaskById("t1")?.isCompleted).toBe(true);
	});
});

describe("tasks_uncomplete", () => {
	it("reopens a completed task", async () => {
		await harness.client.callTool({
			name: "todoist_tasks_complete",
			arguments: {
				id: "t1",
			},
		});
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_uncomplete",
			arguments: {
				id: "t1",
			},
		});
		expect(structuredContent).toMatchObject({ ok: true, reopened: 1 });
		expect(harness.container.db.getTaskById("t1")?.isCompleted).toBe(false);
	});
});

describe("tasks_update", () => {
	it("updates task title", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_update",
			arguments: {
				id: "t1",
				title: "Alpha task updated",
			},
		});
		expect(structuredContent).toMatchObject({ content: "Alpha task updated" });
	});

	it("appends a new label to existing labels", async () => {
		await harness.client.callTool({
			name: "todoist_tasks_update",
			arguments: {
				id: "t1",
				addLabels: ["new"],
			},
		});
		expect(harness.container.db.getTaskById("t1")?.labels).toEqual([
			"urgent",
			"new",
		]);
	});

	it("does not duplicate an existing label", async () => {
		await harness.client.callTool({
			name: "todoist_tasks_update",
			arguments: {
				id: "t1",
				addLabels: ["urgent"],
			},
		});
		expect(harness.container.db.getTaskById("t1")?.labels).toEqual(["urgent"]);
	});

	it("passes sectionId when section is provided", async () => {
		await harness.client.callTool({
			name: "todoist_tasks_update",
			arguments: {
				id: "t2",
				section: "Backlog",
			},
		});
		expect(harness.container.db.getTaskById("t2")?.sectionId).toBe("Backlog");
	});
});

describe("tasks_move", () => {
	it("moves a task to another project", async () => {
		await harness.client.callTool({
			name: "todoist_tasks_move",
			arguments: {
				id: "t1",
				project: "Personal",
			},
		});
		expect(harness.container.db.getTaskById("t1")?.projectId).toBe("p2");
	});
});

describe("tasks_add", () => {
	it("creates a new task", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "New task",
				project: "p1",
			},
		});
		expect(structuredContent).toMatchObject({ content: "New task" });
	});

	it("resolves project by name when a name is passed to 'project'", async () => {
		await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "Named project task",
				project: "Work",
			},
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
		await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "Literal project task",
				project: "literal-id",
			},
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
		await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "Sectioned task",
				section: "Backlog",
			},
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
		await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "Subtask",
				parentId: "parent-task-id",
			},
		});
		expect(harness.container.client.sync).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				type: "item_add",
				args: expect.objectContaining({
					parent_id: "parent-task-id",
				}) as unknown,
			}),
		);
	});
});

describe("tasks_comments_add", () => {
	it("rejects a comment one over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_tasks_comments_add",
			arguments: {
				taskId: "t1",
				content: "x".repeat(LIMITS.taskComment + 1),
			},
		});
		expect(result.isError).toBe(true);
	});
});

describe("tasks_add — Todoist limits", () => {
	it("rejects a title one over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: { title: "x".repeat(LIMITS.taskName + 1) },
		});
		expect(result.isError).toBe(true);
	});

	it("rejects a description one over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "ok",
				description: "x".repeat(LIMITS.taskDescription + 1),
			},
		});
		expect(result.isError).toBe(true);
	});

	it("rejects a due string one over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "ok",
				due: "x".repeat(LIMITS.date + 1),
			},
		});
		expect(result.isError).toBe(true);
	});

	it("rejects a label name one over the cap", async () => {
		const result = await harness.client.callTool({
			name: "todoist_tasks_add",
			arguments: {
				title: "ok",
				labels: ["x".repeat(LIMITS.labelName + 1)],
			},
		});
		expect(result.isError).toBe(true);
	});
});
