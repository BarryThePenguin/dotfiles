import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container } from "./container.ts";
import type { Database } from "./db.ts";
import {
	addTask,
	completeTask,
	updateTask,
	type OperationResult,
} from "./index.ts";
import { logger } from "./logger.ts";
import { listSections, resolveProject } from "./operations.ts";
import type { AppTask } from "./schema.ts";
import {
	AddTaskFieldsSchema,
	ListTaskSchema,
	TasksUpdateInputSchema,
} from "./schemas.ts";
import { countSyncData, syncAndPersist } from "./sync.ts";
import {
	propagateMeta,
	recordException,
	tracer,
	trackOperation,
} from "./telemetry.ts";

function formatResult(result: OperationResult<AppTask>) {
	if (!result.ok) {
		return {
			ok: false,
			hint: "The task has conflicts. Review and retry.",
		};
	}
	return result.result ? result.result : { ok: true };
}

// ── Input schemas ─────────────────────────────────────────────
const EmptyInput = v.object({ sync: v.optional(v.boolean(), false) });
const IdInput = v.object({ id: v.string() });
const SyncInput = v.object({ sync: v.optional(v.boolean(), false) });

const FullSyncInput = v.object({ full: v.optional(v.boolean(), false) });

const SectionsListInput = v.object({
	project: v.optional(v.string()),
	...SyncInput.entries,
});

// -- Output schemas ───────────────────────────────────────────
const FormattedTaskSchema = v.object({
	id: v.string(),
	projectId: v.nullable(v.string()),
	sectionId: v.nullable(v.string()),
	content: v.string(),
	due: v.nullable(
		v.object({
			date: v.string(),
			string: v.string(),
			isRecurring: v.boolean(),
		}),
	),
	completed: v.boolean(),
	addedAt: v.nullable(v.string()),
	labels: v.array(v.string()),
	priority: v.nullable(v.number()),
	description: v.nullable(v.string()),
});

const ListTaskItemSchema = v.pick(FormattedTaskSchema, ["id", "content"]);

// ── Database object schemas ───────────────────────────────────
const DbProjectSchema = v.object({
	id: v.string(),
	name: v.string(),
	color: v.nullable(v.string()),
	isFavorite: v.boolean(),
	isInbox: v.boolean(),
});

const ListLabelSchema = v.object({
	id: v.string(),
	name: v.string(),
});

const DbSectionSchema = v.object({
	id: v.string(),
	projectId: v.string(),
	name: v.string(),
	order: v.nullable(v.number()),
});

// Conflict object for mutation result
const ConflictSchema = v.object({
	taskId: v.string(),
	field: v.optional(v.string()),
	reason: v.string(),
});

function requireDb(db: Database | null): asserts db is Database {
	if (!db) {
		throw new Error("no .doistrc found in this git repository");
	}
}

export function buildServer({
	paths,
	db,
	listProjectIds,
	projectCount,
	client,
}: Container): McpServer {
	const mcp = new McpServer({ name: "doist", version: "0.1.0" });

	mcp.registerTool(
		"todoist_sync",
		{
			description: "Pull all Todoist data into the local database",
			inputSchema: toStandardJsonSchema(FullSyncInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					projects: v.number(),
					sections: v.number(),
					labels: v.number(),
					tasks: v.number(),
					reconciled: v.number(),
				}),
			),
		},
		async ({ full }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_sync",
				{},
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						span.setAttribute("sync.full", full);
						logger.info({ operation: "todoist_sync", full }, "Starting sync");
						const result = await syncAndPersist(
							db,
							client,
							listProjectIds(),
							full,
						);
						const counts = countSyncData(result);
						logger.info(
							{
								operation: "todoist_sync",
								...counts,
							},
							"Sync completed",
						);
						trackOperation("todoist_sync", true, {
							"sync.full": full,
							"sync.projects": counts.projects,
							"sync.sections": counts.sections,
							"sync.labels": counts.labels,
							"sync.tasks": counts.tasks,
							"sync.reconciled": counts.reconciled,
						});
						return {
							content: [
								{
									type: "text" as const,
									text: `Last synced at ${db.getLastSyncedAt()}`,
								},
							],
							structuredContent: counts,
						};
					} catch (err) {
						logger.error(
							{
								operation: "todoist_sync",
								error: err instanceof Error ? err.message : String(err),
							},
							"Sync failed",
						);
						recordException(span, err);
						trackOperation("todoist_sync", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_tasks_list",
		{
			description:
				"List incomplete tasks from the local database. Returns id and content only; use tasks_get to fetch full task details.",
			inputSchema: toStandardJsonSchema(ListTaskSchema),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(
						v.object({
							projects: v.number(),
							sections: v.number(),
							labels: v.number(),
							tasks: v.number(),
							reconciled: v.number(),
						}),
					),
					tasks: v.array(ListTaskItemSchema),
				}),
			),
		},
		async ({ project, sync: shouldSync, ...rest }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_tasks_list",
				{ attributes: { project } },
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						let syncResult = undefined;
						if (shouldSync) {
							logger.info(
								{
									operation: "todoist_tasks_list",
									sync: true,
								},
								"Syncing before list",
							);
							const result = await syncAndPersist(
								db,
								client,
								listProjectIds(),
								false,
							);
							syncResult = countSyncData(result);
						}

						logger.info(
							{
								operation: "todoist_tasks_list",
								project,
								filters: { ...rest },
							},
							"Listing tasks",
						);
						const tasks = db
							.selectTasksByFilters({
								...rest,
								project: project ? resolveProject(db, project) : undefined,
							})
							.map((t) => ({ id: t.id, content: t.content }));
						const syncedAt = db.getLastSyncedAt();
						logger.info(
							{
								operation: "todoist_tasks_list",
								count: tasks.length,
								project,
							},
							"Tasks retrieved",
						);
						trackOperation("todoist_tasks_list", true, {
							"result.count": tasks.length,
							"filter.project": project ? 1 : 0,
							"filter.priority": rest.priority ? 1 : 0,
							"filter.label": rest.label ? 1 : 0,
							"filter.due": rest.due ? 1 : 0,
							"sync.performed": shouldSync ? 1 : 0,
						});
						return {
							content: [
								{ type: "text" as const, text: `Last synced at ${syncedAt}` },
							],
							structuredContent: { sync: syncResult, tasks, syncedAt },
						};
					} catch (err) {
						logger.error(
							{
								operation: "todoist_tasks_list",
								error: err instanceof Error ? err.message : String(err),
								project,
							},
							"Task listing failed",
						);
						recordException(span, err);
						trackOperation("todoist_tasks_list", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"tasks_get",
		{
			description: "Get a single task by ID from the local database",
			inputSchema: toStandardJsonSchema(IdInput),
			outputSchema: toStandardJsonSchema(FormattedTaskSchema),
		},
		({ id }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_tasks_get",
				{ attributes: { id } },
				propagateMeta(mcpReq._meta),
				(span) => {
					try {
						requireDb(db);
						const task = db.selectTaskById(id);
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
							content: [{ type: "text" as const, text: `Task ${id}` }],
							structuredContent: task,
						};
					} catch (err) {
						if (!String(err).includes("not_found")) {
							trackOperation("todoist_tasks_get", false);
						}
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_tasks_complete",
		{
			description: "Mark a task complete in Todoist",
			inputSchema: toStandardJsonSchema(IdInput),
			outputSchema: toStandardJsonSchema(
				v.union([
					FormattedTaskSchema,
					v.object({
						ok: v.boolean(),
						conflicts: v.optional(v.array(ConflictSchema)),
					}),
				]),
			),
		},
		async ({ id }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_tasks_complete",
				{ attributes: { id } },
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						if (!db.selectTaskById(id)) {
							trackOperation("todoist_tasks_complete", false, {
								"error.type": "not_found",
							});
							throw new Error(`task not found: ${id}`);
						}

						const result = await completeTask(db, client, id);
						trackOperation("todoist_tasks_complete", result.ok, {
							"result.conflict": result.ok ? 0 : 1,
						});

						return {
							content: [
								{ type: "text" as const, text: `Completed task ${id}` },
							],
							structuredContent: formatResult(result),
						};
					} catch (err) {
						if (!String(err).includes("not_found")) {
							trackOperation("todoist_tasks_complete", false);
						}
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_tasks_update",
		{
			description: "Update a task in Todoist",
			inputSchema: toStandardJsonSchema(TasksUpdateInputSchema),
			outputSchema: toStandardJsonSchema(
				v.union([
					FormattedTaskSchema,
					v.object({
						ok: v.boolean(),
						conflicts: v.optional(v.array(ConflictSchema)),
					}),
				]),
			),
		},
		async ({ id, ...fields }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_tasks_update",
				{ attributes: { id } },
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						if (!db.selectTaskById(id)) {
							trackOperation("todoist_tasks_update", false, {
								"error.type": "not_found",
							});
							throw new Error(`task not found: ${id}`);
						}

						const result = await updateTask(db, client, id, fields);
						const fieldsChanged = Object.keys(fields);
						trackOperation("todoist_tasks_update", result.ok, {
							"result.conflict": result.ok ? 0 : 1,
							"fields.changed": fieldsChanged.length,
							"field.content": fieldsChanged.includes("content") ? 1 : 0,
							"field.priority": fieldsChanged.includes("priority") ? 1 : 0,
							"field.labels": fieldsChanged.includes("labels") ? 1 : 0,
							"field.due": fieldsChanged.includes("due") ? 1 : 0,
							"field.description": fieldsChanged.includes("description")
								? 1
								: 0,
						});

						return {
							content: [{ type: "text" as const, text: `Updated task ${id}` }],
							structuredContent: formatResult(result),
						};
					} catch (err) {
						recordException(span, err);
						if (!String(err).includes("not_found")) {
							trackOperation("todoist_tasks_update", false);
						}
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_tasks_add",
		{
			description: "Add a new task to Todoist",
			inputSchema: toStandardJsonSchema(AddTaskFieldsSchema),
			outputSchema: toStandardJsonSchema(
				v.union([
					FormattedTaskSchema,
					v.object({
						ok: v.boolean(),
						conflicts: v.optional(v.array(ConflictSchema)),
					}),
				]),
			),
		},
		async (fields, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_tasks_add",
				{},
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						const result = await addTask(db, client, fields);
						trackOperation("todoist_tasks_add", true, {
							"task.project": fields.project ? 1 : 0,
							"task.priority": fields.priority || 0,
							"task.labels": fields.labels
								? Object.keys(fields.labels).length
								: 0,
							"task.hasDescription": fields.description ? 1 : 0,
							"task.hasDue": fields.due ? 1 : 0,
						});
						return {
							content: [{ type: "text" as const, text: `Added task` }],
							structuredContent: formatResult(result),
						};
					} catch (err) {
						recordException(span, err);
						trackOperation("todoist_tasks_add", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_projects_list",
		{
			description: "List all projects from the local database",
			inputSchema: toStandardJsonSchema(EmptyInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(
						v.object({
							projects: v.number(),
							sections: v.number(),
							labels: v.number(),
							tasks: v.number(),
							reconciled: v.number(),
						}),
					),
					projects: v.array(DbProjectSchema),
				}),
			),
		},
		async ({ sync: shouldSync }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_projects_list",
				{},
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						let syncResult = undefined;
						if (shouldSync) {
							logger.info(
								{
									operation: "todoist_projects_list",
									sync: true,
								},
								"Syncing before list",
							);
							const result = await syncAndPersist(
								db,
								client,
								listProjectIds(),
								false,
							);
							syncResult = countSyncData(result);
						}

						const projectList = db.selectAllProjects();
						trackOperation("todoist_projects_list", true, {
							"result.count": projectList.length,
							"sync.performed": shouldSync ? 1 : 0,
						});
						return {
							content: [{ type: "text" as const, text: "Projects" }],
							structuredContent: { sync: syncResult, projects: projectList },
						};
					} catch (err) {
						recordException(span, err);
						trackOperation("todoist_projects_list", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_labels_list",
		{
			description: "List all labels from the local database",
			inputSchema: toStandardJsonSchema(EmptyInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(
						v.object({
							projects: v.number(),
							sections: v.number(),
							labels: v.number(),
							tasks: v.number(),
							reconciled: v.number(),
						}),
					),
					labels: v.array(ListLabelSchema),
				}),
			),
		},
		async ({ sync: shouldSync }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_labels_list",
				{},
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						let syncResult = undefined;
						if (shouldSync) {
							logger.info(
								{
									operation: "todoist_labels_list",
									sync: true,
								},
								"Syncing before list",
							);
							const result = await syncAndPersist(
								db,
								client,
								listProjectIds(),
								false,
							);
							syncResult = countSyncData(result);
						}

						const labels = db
							.selectAllLabels()
							.map(({ id, name }) => ({ id, name }));
						trackOperation("todoist_labels_list", true, {
							"result.count": labels.length,
							"sync.performed": shouldSync ? 1 : 0,
						});
						return {
							content: [{ type: "text" as const, text: "Labels" }],
							structuredContent: { sync: syncResult, labels },
						};
					} catch (err) {
						recordException(span, err);
						trackOperation("todoist_labels_list", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_sections_list",
		{
			description:
				"List all sections for a given project from the local database",
			inputSchema: toStandardJsonSchema(SectionsListInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(
						v.object({
							projects: v.number(),
							sections: v.number(),
							labels: v.number(),
							tasks: v.number(),
							reconciled: v.number(),
						}),
					),
					sections: v.array(DbSectionSchema),
				}),
			),
		},
		async ({ project, sync: shouldSync }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_sections_list",
				{ attributes: { project } },
				propagateMeta(mcpReq._meta),
				async (span) => {
					try {
						requireDb(db);
						let syncResult = undefined;
						if (shouldSync) {
							logger.info(
								{
									operation: "todoist_sections_list",
									sync: true,
									project,
								},
								"Syncing before list",
							);
							const result = await syncAndPersist(
								db,
								client,
								listProjectIds(),
								false,
							);
							syncResult = countSyncData(result);
						}

						const sections = listSections(
							db,
							project ? resolveProject(db, project) : undefined,
						);
						trackOperation("todoist_sections_list", true, {
							"result.count": sections.length,
							"filter.project": project ? 1 : 0,
							"sync.performed": shouldSync ? 1 : 0,
						});
						return {
							content: [
								{
									type: "text" as const,
									text: `Sections for project ${project}`,
								},
							],
							structuredContent: { sync: syncResult, sections },
						};
					} catch (err) {
						recordException(span, err);
						trackOperation("todoist_sections_list", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_tasks_search",
		{
			description: "Search incomplete tasks by keyword match on task content",
			inputSchema: toStandardJsonSchema(v.object({ query: v.string() })),
			outputSchema: toStandardJsonSchema(
				v.object({
					tasks: v.array(FormattedTaskSchema),
				}),
			),
		},
		({ query }, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_tasks_search",
				{ attributes: { query } },
				propagateMeta(mcpReq._meta),
				(span) => {
					try {
						requireDb(db);
						const tasks = db.searchTasksByContent(query);
						trackOperation("todoist_tasks_search", true, {
							"result.count": tasks.length,
							"query.length": query.length,
						});
						return {
							content: [
								{
									type: "text" as const,
									text: `Search results for "${query}"`,
								},
							],
							structuredContent: { tasks },
						};
					} catch (err) {
						recordException(span, err);
						trackOperation("todoist_tasks_search", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerTool(
		"todoist_config",
		{
			description: "Show the active server configuration",
			inputSchema: toStandardJsonSchema(EmptyInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					rcPath: v.optional(v.string()),
					dbPath: v.optional(v.string()),
					projects: v.array(v.string()),
				}),
			),
		},
		(_, { mcpReq }) =>
			tracer.startActiveSpan(
				"todoist_config",
				{ attributes: { ...paths } },
				propagateMeta(mcpReq._meta),
				(span) => {
					try {
						trackOperation("todoist_config", true, {
							"config.projects": projectCount(),
						});
						return {
							content: [
								{
									type: "text" as const,
									text: "Active configuration",
								},
							],
							structuredContent: {
								...paths,
								projects: listProjectIds(),
							},
						};
					} catch (err) {
						recordException(span, err);
						trackOperation("todoist_config", false);
						throw err;
					} finally {
						span.end();
					}
				},
			),
	);

	mcp.registerPrompt(
		"todoist_next_task",
		{
			title: "Which task should I focus on next?",
			description:
				"Get a recommendation on the next task to work on based on priorities, blockers, and due dates",
			argsSchema: toStandardJsonSchema(
				v.object({
					project: v.pipe(
						v.optional(v.string()),
						v.description(
							"Project name to analyze. If omitted, analyzes all tasks.",
						),
					),
				}),
			),
		},
		({ project: projectName }) => {
			try {
				requireDb(db);
				const tasks = projectName
					? db.selectTasksByFilters({
							project: resolveProject(db, projectName),
						})
					: db.selectTasksByFilters({});

				if (tasks.length === 0) {
					return {
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: `I have no tasks in ${projectName || "any project"}. What should I work on?`,
								},
							},
						],
					};
				}

				// Format task list for context
				const taskList = tasks
					.map((t) => {
						const labels = t.labels.length ? ` [${t.labels.join(", ")}]` : "";
						const dueDate = t.due?.string ? ` (due: ${t.due.string})` : "";
						const priority = t.priority ? ` (p${t.priority})` : "";
						return `- ${t.content}${labels}${dueDate}${priority} (${t.id})`;
					})
					.join("\n");

				const prompt = projectName
					? `I'm working on "${projectName}". Here are my tasks:\n\n${taskList}\n\nWhich task should I focus on next?`
					: `Here are all my tasks:\n\n${taskList}\n\nWhich task should I focus on next?`;

				return {
					messages: [
						{
							role: "user",
							content: {
								type: "text",
								text: prompt,
							},
						},
					],
				};
			} catch (err) {
				logger.error(
					{
						error: err instanceof Error ? err.message : String(err),
						project: projectName,
					},
					"Failed to generate task recommendation prompt",
				);
				throw err;
			}
		},
	);

	return mcp;
}
