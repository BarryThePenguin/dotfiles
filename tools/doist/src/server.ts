import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { findPaths, listProjectIds } from "./config.ts";
import { resolveProject } from "./commands/projects.ts";
import { env } from "./env.ts";
import {
	addTask,
	AddTaskFieldsSchema,
	completeTask,
	formatTask,
	getLastSyncedAt,
	getTask,
	listLabels,
	listProjects,
	listSections,
	listTasks,
	ListTaskSchema,
	openDb,
	searchTasks,
	updateTask,
	UpdateTaskFieldsSchema,
	type SyncDb,
} from "./index.ts";
import { sync } from "./sync.ts";
import { createClient } from "./todoist.ts";

function text(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

type DbTask = Parameters<typeof formatTask>[0];
function formatResult(
	result: DbTask | { conflict: true; upstream: DbTask | null } | { ok: true },
) {
	if ("ok" in result) {
		return result;
	}
	if ("conflict" in result) {
		return {
			...result,
			upstream: result.upstream ? formatTask(result.upstream) : null,
			hint: "The task was modified upstream since the last sync. Review the upstream version and retry.",
		};
	}
	return formatTask(result);
}

// ── Input schemas ─────────────────────────────────────────────
const EmptyInput = v.object({});
const IdInput = v.object({ id: v.string() });

const SyncInput = v.object({ full: v.optional(v.boolean(), false) });

const TasksUpdateInput = v.object({
	id: v.string(),
	...UpdateTaskFieldsSchema.entries,
});

const SectionsListInput = v.object({ project: v.optional(v.string()) });

export interface Context {
	server: McpServer;
	db: SyncDb;
}

export function buildServer(
	client = createClient(env.TODOIST_API_TOKEN),
): Context {
	const { rcPath, dbPath } = findPaths();
	const db = openDb(dbPath);
	const server = new McpServer({ name: "doist", version: "0.1.0" });

	server.registerTool(
		"sync",
		{
			description: "Pull all Todoist data into the local database",
			inputSchema: toStandardJsonSchema(SyncInput),
		},
		async ({ full }) => {
			const projects = listProjectIds(rcPath);
			const { updatedTaskIds: _, ...counts } = await sync(
				db,
				client,
				projects,
				full,
			);
			return text(counts);
		},
	);

	server.registerTool(
		"tasks_list",
		{
			description: "List incomplete tasks from the local database",
			inputSchema: toStandardJsonSchema(ListTaskSchema),
		},
		({ project, ...rest }) => {
			const tasks = listTasks(db, {
				...rest,
				project: project ? resolveProject(db, project) : undefined,
			}).map((t) => formatTask(t));
			const syncedAt = getLastSyncedAt(db);
			return text({ syncedAt, tasks });
		},
	);

	server.registerTool(
		"tasks_get",
		{
			description: "Get a single task by ID from the local database",
			inputSchema: toStandardJsonSchema(IdInput),
		},
		({ id }) => {
			const task = getTask(db, id);
			if (!task) {
				throw new Error(`task not found: ${id}`);
			}
			return text(formatTask(task));
		},
	);

	server.registerTool(
		"tasks_complete",
		{
			description: "Mark a task complete in Todoist",
			inputSchema: toStandardJsonSchema(IdInput),
		},
		async ({ id }) => {
			if (!getTask(db, id)) {
				throw new Error(`task not found: ${id}`);
			}
			return text(formatResult(await completeTask(db, client, rcPath, id)));
		},
	);

	server.registerTool(
		"tasks_update",
		{
			description: "Update a task in Todoist",
			inputSchema: toStandardJsonSchema(TasksUpdateInput),
		},
		async ({ id, ...fields }) => {
			if (!getTask(db, id)) {
				throw new Error(`task not found: ${id}`);
			}
			return text(
				formatResult(await updateTask(db, client, rcPath, id, fields)),
			);
		},
	);

	server.registerTool(
		"tasks_add",
		{
			description: "Add a new task to Todoist",
			inputSchema: toStandardJsonSchema(AddTaskFieldsSchema),
		},
		async (fields) => text(formatResult(await addTask(db, client, fields))),
	);

	server.registerTool(
		"projects_list",
		{
			description: "List all projects from the local database",
			inputSchema: toStandardJsonSchema(EmptyInput),
		},
		() => text(listProjects(db)),
	);

	server.registerTool(
		"labels_list",
		{
			description: "List all labels from the local database",
			inputSchema: toStandardJsonSchema(EmptyInput),
		},
		() => text(listLabels(db)),
	);

	server.registerTool(
		"sections_list",
		{
			description:
				"List all sections for a given project from the local database",
			inputSchema: toStandardJsonSchema(SectionsListInput),
		},
		({ project }) =>
			text(listSections(db, project ? resolveProject(db, project) : undefined)),
	);

	server.registerTool(
		"tasks_search",
		{
			description: "Search incomplete tasks by keyword match on task content",
			inputSchema: toStandardJsonSchema(v.object({ query: v.string() })),
		},
		({ query }) => text(searchTasks(db, query).map((t) => formatTask(t))),
	);

	server.registerTool(
		"config",
		{
			description: "Show the active server configuration",
			inputSchema: toStandardJsonSchema(EmptyInput),
		},
		() =>
			text({
				rcPath,
				dbPath,
				projects: listProjectIds(rcPath),
			}),
	);

	return { server, db };
}
