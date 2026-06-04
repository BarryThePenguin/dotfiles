import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container } from "../container.ts";
import {
	addTask,
	completeTasks,
	moveTask,
	uncompleteTasks,
	updateTask,
} from "../index.ts";
import { resolveProject } from "../operations.ts";
import {
	AddTaskFieldsSchema,
	ListTaskSchema,
	TasksUpdateInputSchema,
} from "../schemas.ts";
import { trackOperation } from "../telemetry.ts";
import {
	FormattedTaskSchema,
	ListTaskItemSchema,
	maybeSyncSummary,
	requireDb,
	SyncSummarySchema,
	type ListTaskItem,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

export function registerTaskTools(
	mcp: McpServer,
	{ db, client, listProjectIds }: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_tasks_list",
		config: {
			description:
				"List incomplete tasks from the local database. Returns id and content only by default; set details to true for full task data.",
			inputSchema: toStandardJsonSchema(ListTaskSchema),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
					tasks: v.array(ListTaskItemSchema),
					syncedAt: v.optional(v.nullable(v.string())),
				}),
			),
		},
		spanOptions: ({ project }) => ({ attributes: { project } }),
		callback: async ({ project, details, sync: shouldSync, ...rest }) => {
			requireDb(db);
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);

			const projectId = project ? resolveProject(db, project) : undefined;
			const tasks: ListTaskItem[] = project && !projectId
				? []
				: db
					.selectTasks({
						...rest,
						projectId,
					})
					.map((task) =>
						details ? task : { id: task.id, content: task.content },
					);

			const syncedAt = db.getLastSyncedAt();
			trackOperation("todoist_tasks_list", true, {
				"result.count": tasks.length,
				"filter.project": project ? 1 : 0,
				"filter.priority": rest.priority ? 1 : 0,
				"filter.label": rest.label ? 1 : 0,
				"filter.due": rest.due ? 1 : 0,
				"sync.performed": shouldSync ? 1 : 0,
			});
			return {
				content: [{ type: "text", text: `Last synced at ${syncedAt}` }],
				structuredContent: { sync: syncResult, tasks, syncedAt },
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_get",
		config: {
			description: "Get a single task by ID from the local database",
			inputSchema: toStandardJsonSchema(v.object({ id: v.string() })),
			outputSchema: toStandardJsonSchema(FormattedTaskSchema),
		},
		spanOptions: ({ id }) => ({ attributes: { id } }),
		callback: ({ id }) => {
			requireDb(db);
			const task = db.getTaskById(id);
			if (!task) {
				trackOperation("todoist_tasks_get", false, {
					"error.type": "not_found",
				});
				throw new Error(`task not found: ${id}`);
			}
			trackOperation("todoist_tasks_get", true, {
				"task.priority": task.priority || 0,
			});
			return {
				content: [{ type: "text", text: `Task ${id}` }],
				structuredContent: task,
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_complete",
		config: {
			description: "Mark one or more tasks complete in Todoist",
			inputSchema: toStandardJsonSchema(
				v.object({ id: v.union([v.string(), v.array(v.string())]) }),
			),
			outputSchema: toStandardJsonSchema(
				v.object({ ok: v.boolean(), completed: v.number() }),
			),
		},
		spanOptions: ({ id }) => ({
			attributes: { id: Array.isArray(id) ? id.join(",") : id },
		}),
		callback: async ({ id }) => {
			requireDb(db);
			const taskIds = Array.isArray(id) ? id : [id];
			const result = await completeTasks(db, client, taskIds);
			trackOperation("todoist_tasks_complete", result.ok, {
				"result.count": result.result ?? 0,
			});
			return {
				content: [
					{
						type: "text",
						text:
							taskIds.length === 1
								? `Completed task ${taskIds[0]}`
								: `Completed ${result.result} tasks`,
					},
				],
				structuredContent: {
					ok: result.ok,
					completed: result.result ?? 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_uncomplete",
		config: {
			description: "Mark one or more tasks incomplete in Todoist",
			inputSchema: toStandardJsonSchema(
				v.object({ id: v.union([v.string(), v.array(v.string())]) }),
			),
			outputSchema: toStandardJsonSchema(
				v.object({ ok: v.boolean(), reopened: v.number() }),
			),
		},
		spanOptions: ({ id }) => ({
			attributes: { id: Array.isArray(id) ? id.join(",") : id },
		}),
		callback: async ({ id }) => {
			requireDb(db);
			const taskIds = Array.isArray(id) ? id : [id];
			const result = await uncompleteTasks(db, client, taskIds);
			trackOperation("todoist_tasks_uncomplete", result.ok, {
				"result.count": result.result ?? 0,
			});
			return {
				content: [
					{
						type: "text",
						text:
							taskIds.length === 1
								? `Reopened task ${taskIds[0]}`
								: `Reopened ${result.result} tasks`,
					},
				],
				structuredContent: {
					ok: result.ok,
					reopened: result.result ?? 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_update",
		config: {
			description: "Update a task in Todoist",
			inputSchema: toStandardJsonSchema(TasksUpdateInputSchema),
			outputSchema: toStandardJsonSchema(FormattedTaskSchema),
		},
		spanOptions: ({ id }) => ({ attributes: { id } }),
		callback: async ({ id, ...fields }) => {
			requireDb(db);
			if (!db.getTaskById(id)) {
				trackOperation("todoist_tasks_update", false, {
					"error.type": "not_found",
				});
				throw new Error(`task not found: ${id}`);
			}
			const result = await updateTask(db, client, id, fields);
			const fieldsChanged = Object.keys(fields);
			trackOperation("todoist_tasks_update", result.ok, {
				"fields.changed": fieldsChanged.length,
				"field.content": fieldsChanged.includes("content") ? 1 : 0,
				"field.priority": fieldsChanged.includes("priority") ? 1 : 0,
				"field.labels": fieldsChanged.includes("labels") ? 1 : 0,
				"field.due": fieldsChanged.includes("due") ? 1 : 0,
				"field.description": fieldsChanged.includes("description") ? 1 : 0,
			});
			return {
				content: [{ type: "text", text: `Updated task ${id}` }],
				structuredContent: result.result ? result.result : { ok: true },
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_move",
		config: {
			description: "Move a task to another project in Todoist",
			inputSchema: toStandardJsonSchema(
				v.object({
					id: v.string(),
					project: v.string(),
				}),
			),
			outputSchema: toStandardJsonSchema(FormattedTaskSchema),
		},
		spanOptions: ({ id, project }) => ({ attributes: { id, project } }),
		callback: async ({ id, project }) => {
			requireDb(db);
			if (!db.getTaskById(id)) {
				trackOperation("todoist_tasks_move", false, {
					"error.type": "not_found",
				});
				throw new Error(`task not found: ${id}`);
			}
			const result = await moveTask(db, client, id, project);
			trackOperation("todoist_tasks_move", result.ok);
			return {
				content: [{ type: "text", text: `Moved task ${id}` }],
				structuredContent: result.result ? result.result : { ok: true },
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_add",
		config: {
			description: "Add a new task to Todoist",
			inputSchema: toStandardJsonSchema(AddTaskFieldsSchema),
			outputSchema: toStandardJsonSchema(FormattedTaskSchema),
		},
		spanOptions: {},
		callback: async (fields) => {
			requireDb(db);
			const result = await addTask(db, client, fields);
			trackOperation("todoist_tasks_add", true, {
				"task.project": fields.project ? 1 : 0,
				"task.priority": fields.priority || 0,
				"task.labels": fields.labels ? Object.keys(fields.labels).length : 0,
				"task.hasDescription": fields.description ? 1 : 0,
				"task.hasDue": fields.due ? 1 : 0,
			});
			return {
				content: [{ type: "text", text: "Added task" }],
				structuredContent: result.result ? result.result : { ok: true },
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_search",
		config: {
			description: "Search incomplete tasks by keyword match on task content",
			inputSchema: toStandardJsonSchema(v.object({ query: v.string() })),
			outputSchema: toStandardJsonSchema(
				v.object({ tasks: v.array(FormattedTaskSchema) }),
			),
		},
		spanOptions: ({ query }) => ({ attributes: { query } }),
		callback: ({ query }) => {
			requireDb(db);
			const tasks = db.selectTasks({
				content: query,
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
			});
			trackOperation("todoist_tasks_search", true, {
				"result.count": tasks.length,
				"query.length": query.length,
			});
			return {
				content: [
					{
						type: "text",
						text: `Search results for "${query}"`,
					},
				],
				structuredContent: { tasks },
			};
		},
	});
}
