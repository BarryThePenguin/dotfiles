import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container } from "doist-core";
import {
	addTask,
	addTaskComment,
	completeTasks,
	listTaskComments,
	moveTask,
	uncompleteTasks,
	updateTask,
	resolveProject,
	AddCommentFieldsSchema,
	AddTaskFieldsSchema,
	ListTaskSchema,
	TasksUpdateInputSchema,
} from "doist-core";
import {
	FormattedTaskSchema,
	ListTaskItemSchema,
	maybeSyncSummary,
	SyncSummarySchema,
	type ListTaskItem,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

export function registerTaskTools(mcp: McpServer, container: Container): void {
	registerTool({
		mcp,
		name: "todoist_tasks_list",
		config: {
			description:
				"List incomplete tasks from the local database. Returns id and content only by default; set details to true for full task data.",
			inputSchema: toStandardJsonSchema(
				v.pipe(
					ListTaskSchema,
					v.description(
						"Task filters, optional details flag, and optional sync toggle.",
					),
				),
			),
			outputSchema: toStandardJsonSchema(
				v.pipe(
					v.object({
						sync: v.optional(SyncSummarySchema),
						tasks: v.array(ListTaskItemSchema),
						syncedAt: v.optional(v.nullable(v.string())),
					}),
					v.description(
						"Tasks and optional sync summary plus last synced timestamp.",
					),
				),
			),
		},
		spanOptions: (args: { project?: string }) => ({
			attributes: { project: args.project },
		}),
		callback: async ({ project, details, sync: shouldSync, ...rest }) => {
			const { db, client, listProjectIds } = container;
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);

			const projectId = project ? resolveProject(db, project) : undefined;
			const { priority, ...filters } = rest;
			const tasks: ListTaskItem[] =
				project && !projectId
					? []
					: db
							.selectTasks({
								...filters,
								...(priority !== undefined ? { priority } : {}),
								...(projectId ? { projectId } : {}),
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
		spanOptions: (args: { id: string | string[] }) => ({
			attributes: { id: Array.isArray(args.id) ? args.id.join(",") : args.id },
		}),
		callback: async ({ id }: { id: string | string[] }) => {
			const { db, client } = container;
			const taskIds = Array.isArray(id) ? id : [id];
			const result = await completeTasks(db, client, taskIds);
			return {
				data: { ok: result.ok, completed: result.result },
				text:
					taskIds.length === 1
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
		spanOptions: (args: { id: string | string[] }) => ({
			attributes: {
				id: Array.isArray(args.id) ? args.id.join(",") : args.id,
			},
		}),
		callback: async ({ id }: { id: string | string[] }) => {
			const { db, client } = container;
			const taskIds = Array.isArray(id) ? id : [id];
			const result = await uncompleteTasks(db, client, taskIds);
			return {
				data: { ok: result.ok, reopened: result.result },
				text:
					taskIds.length === 1
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
			inputSchema: toStandardJsonSchema(
				v.pipe(
					TasksUpdateInputSchema,
					v.description("Task ID plus fields to update."),
				),
			),
			outputSchema: toStandardJsonSchema(
				v.pipe(FormattedTaskSchema, v.description("Updated formatted task.")),
			),
		},
		spanOptions: (args: { id: string }) => ({
			attributes: { id: args.id },
		}),
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
		spanOptions: (args: { id: string; project: string }) => ({
			attributes: { id: args.id, project: args.project },
		}),
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
		spanOptions: (args: { query: string }) => ({
			attributes: { query: args.query },
		}),
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

	// ── Comments (Notes) ─────────────────────────────────────────────
	registerTool({
		mcp,
		name: "todoist_tasks_comments_list",
		config: {
			description: "List comments (notes) for a task",
			inputSchema: toStandardJsonSchema(
				v.object({
					taskId: v.string(),
					sync: v.optional(v.boolean(), false),
				}),
			),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
					comments: v.array(
						v.object({
							id: v.string(),
							taskId: v.string(),
							content: v.string(),
							postedAt: v.optional(v.nullable(v.string())),
						}),
					),
				}),
			),
		},
		spanOptions: (args: { taskId: string }) => ({
			attributes: { taskId: args.taskId },
		}),
		callback: async ({ taskId, sync: shouldSync }) => {
			const { db, client, listProjectIds } = container;
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);

			const result = listTaskComments(db, taskId);
			const comments = result.result.map((n) => ({
				id: n.id,
				taskId: n.itemId,
				content: n.content,
				postedAt: n.postedAt,
			}));

			return {
				data: { sync: syncResult, comments },
				text: `Listed ${comments.length} comments for task ${taskId}`,
				track: {
					"result.count": comments.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_tasks_comments_add",
		config: {
			description: "Add a comment (note) to a task",
			inputSchema: toStandardJsonSchema(AddCommentFieldsSchema),
			outputSchema: toStandardJsonSchema(
				v.object({
					id: v.string(),
					taskId: v.string(),
					content: v.string(),
					postedAt: v.optional(v.nullable(v.string())),
				}),
			),
		},
		spanOptions: (args: { taskId: string; content: string }) => ({
			attributes: { taskId: args.taskId },
		}),
		callback: async ({ taskId, content }) => {
			const { db, client } = container;
			const result = await addTaskComment(db, client, taskId, content);
			const note = result.result;

			return {
				data: {
					id: note.id,
					taskId: note.itemId,
					content: note.content,
					postedAt: note.postedAt,
				},
				text: `Added comment to task ${taskId}`,
				track: {
					"content.length": content.length,
				},
			};
		},
	});
}
