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
import {
	FormattedTaskSchema,
	ListTaskItemSchema,
	maybeSyncSummary,
	SyncSummarySchema,
	type ListTaskItem,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

export function registerTaskTools(
	mcp: McpServer,
	container: Container,
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
			const { db, client, listProjectIds } = container;
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
			return {
				data: { sync: syncResult, tasks, syncedAt },
				text: `Last synced at ${syncedAt}`,
				track: {
					"result.count": tasks.length,
					"filter.project": project ? 1 : 0,
					"filter.priority": rest.priority ? 1 : 0,
					"filter.label": rest.label ? 1 : 0,
					"filter.due": rest.due ? 1 : 0,
					"sync.performed": shouldSync ? 1 : 0,
				},
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
			const { db, client } = container;
			const taskIds = Array.isArray(id) ? id : [id];
			const result = await completeTasks(db, client, taskIds);
			return {
				data: { ok: result.ok, completed: result.result },
				text: taskIds.length === 1
					? `Completed task ${taskIds[0]}`
					: `Completed ${result.result} tasks`,
				track: { "result.count": result.result },
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
			const { db, client } = container;
			const taskIds = Array.isArray(id) ? id : [id];
			const result = await uncompleteTasks(db, client, taskIds);
			return {
				data: { ok: result.ok, reopened: result.result },
				text: taskIds.length === 1
					? `Reopened task ${taskIds[0]}`
					: `Reopened ${result.result} tasks`,
				track: { "result.count": result.result },
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
			const { db, client } = container;
			if (Object.values(fields).every((v) => v === undefined)) {
				throw new Error("at least one field must be provided");
			}
			if (!db.getTaskById(id)) {
				throw new Error(`task not found: ${id}`);
			}
			const result = await updateTask(db, client, id, fields);
			const fieldsChanged = Object.keys(fields);
			return {
				data: result.result,
				text: `Updated task ${id}`,
				track: {
					"fields.changed": fieldsChanged.length,
					"field.content": fieldsChanged.includes("content") ? 1 : 0,
					"field.priority": fieldsChanged.includes("priority") ? 1 : 0,
					"field.labels": fieldsChanged.includes("labels") ? 1 : 0,
					"field.due": fieldsChanged.includes("due") ? 1 : 0,
					"field.description": fieldsChanged.includes("description") ? 1 : 0,
				},
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
			const { db, client } = container;
			if (!db.getTaskById(id)) {
				throw new Error(`task not found: ${id}`);
			}
			const result = await moveTask(db, client, id, project);
			return {
				data: result.result,
				text: `Moved task ${id}`,
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
			const { db, client } = container;
			const result = await addTask(db, client, fields);
			return {
				data: result.result,
				text: "Added task",
				track: {
					"task.project": fields.project ? 1 : 0,
					"task.priority": fields.priority || 0,
					"task.labels": fields.labels ? Object.keys(fields.labels).length : 0,
					"task.hasDescription": fields.description ? 1 : 0,
					"task.hasDue": fields.due ? 1 : 0,
				},
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
			const { db } = container;
			const tasks = db.selectTasks({
				content: query,
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
			});
			return {
				data: { tasks },
				text: `Search results for "${query}"`,
				track: {
					"result.count": tasks.length,
					"query.length": query.length,
				},
			};
		},
	});
}
