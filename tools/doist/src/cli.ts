#!/usr/bin/env node

import { shutdown } from "./instrumentation/cli.ts";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import { defineCommand, runMain } from "citty";
import { basename } from "node:path";
import * as v from "valibot";
import { createContainer } from "./container.ts";
import { addTask, completeTask, updateTask } from "./index.ts";
import { listSections, resolveProject } from "./operations.ts";
import { out } from "./output.ts";
import { parseAddTaskFields, parseUpdateTaskFields } from "./schemas.ts";
import { ATTR_EXITCODE } from "./semconv.ts";
import { countSyncData, syncAndPersist } from "./sync.ts";
import { tracer } from "./telemetry.ts";

const container = createContainer();
const { db, addProject, removeProject, listProjectIds, client } = container;

const parseListTask = v.parser(
	v.object({
		project: v.optional(v.string()),
		due: v.optional(v.picklist(["today", "overdue"] as const)),
		priority: v.optional(
			v.pipe(
				v.string(),
				v.toNumber(),
				v.integer(),
				v.minValue(1),
				v.maxValue(4),
			),
		),
		label: v.optional(v.string()),
		limit: v.optional(
			v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)),
		),
		offset: v.optional(
			v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0)),
		),
	}),
);

// ── sync ──────────────────────────────────────────────────────
const syncCmd = defineCommand({
	meta: { description: "Pull all data from Todoist into the local database" },
	args: {
		full: {
			type: "boolean",
			description: "reset sync token and perform a full re-fetch",
		},
	},
	async run({ args }) {
		const result = await syncAndPersist(
			db,
			client,
			listProjectIds(),
			args.full ?? false,
		);
		out(countSyncData(result));
	},
});

// ── projects ──────────────────────────────────────────────────
const projectsCmd = defineCommand({
	meta: { description: "Manage projects" },
	subCommands: {
		list: defineCommand({
			meta: { description: "List all projects" },
			args: {
				sync: {
					type: "boolean",
					description: "sync before listing",
				},
			},
			async run({ args }) {
				if (args.sync) {
					const syncResult = await syncAndPersist(
						db,
						client,
						listProjectIds(),
						false,
					);
					out({
						synced: countSyncData(syncResult),
						projects: db.selectAllProjects(),
					});
				} else {
					out(db.selectAllProjects());
				}
			},
		}),
		add: defineCommand({
			meta: { description: "Add a project to the sync allowlist" },
			args: {
				id: { type: "positional", description: "project id", required: true },
				label: {
					type: "positional",
					description: "project label",
					required: true,
				},
			},
			run({ args }) {
				addProject({ id: args.id, label: args.label });
				out({ ok: true, added: { id: args.id, label: args.label } });
			},
		}),
		remove: defineCommand({
			meta: { description: "Remove a project from the sync allowlist by id" },
			args: {
				id: { type: "positional", description: "project id", required: true },
			},
			run({ args }) {
				removeProject(args.id);
				out({ ok: true, removed: args.id });
			},
		}),
	},
});

// ── sections ──────────────────────────────────────────────────
const sectionsCmd = defineCommand({
	meta: { description: "Manage sections" },
	subCommands: {
		list: defineCommand({
			meta: { description: "List all sections" },
			args: {
				project: { type: "string", description: "filter by project id" },
				sync: {
					type: "boolean",
					description: "sync before listing",
				},
			},
			async run({ args }) {
				const project = args.project
					? resolveProject(db, args.project)
					: undefined;
				if (args.sync) {
					const syncResult = await syncAndPersist(
						db,
						client,
						listProjectIds(),
						false,
					);

					out({
						synced: countSyncData(syncResult),
						sections: listSections(db, project),
					});
				} else {
					out(listSections(db, project));
				}
			},
		}),
	},
});

// ── labels ────────────────────────────────────────────────────
const labelsCmd = defineCommand({
	meta: { description: "Manage labels" },
	subCommands: {
		list: defineCommand({
			meta: { description: "List all labels" },
			args: {
				sync: {
					type: "boolean",
					description: "sync before listing",
				},
			},
			async run({ args }) {
				if (args.sync) {
					const syncResult = await syncAndPersist(
						db,
						client,
						listProjectIds(),
						false,
					);
					out({
						synced: countSyncData(syncResult),
						labels: db.selectAllLabels(),
					});
				} else {
					out(db.selectAllLabels());
				}
			},
		}),
	},
});

// ── tasks ─────────────────────────────────────────────────────
const tasksCmd = defineCommand({
	meta: { description: "Manage tasks" },
	subCommands: {
		list: defineCommand({
			meta: { description: "List incomplete tasks" },
			args: {
				project: { type: "string", description: "filter by project id" },
				due: {
					type: "string",
					description: "filter by due date (today, overdue)",
				},
				priority: { type: "string", description: "filter by priority (1-4)" },
				label: { type: "string", description: "filter by label name" },
				limit: {
					type: "string",
					description: "maximum number of tasks to return",
				},
				offset: { type: "string", description: "number of tasks to skip" },
				sync: {
					type: "boolean",
					description: "sync before listing",
				},
			},
			async run({ args }) {
				const fields = parseListTask({
					...args,
					priority:
						args.priority !== undefined ? Number(args.priority) : undefined,
					limit: args.limit !== undefined ? Number(args.limit) : undefined,
					offset: args.offset !== undefined ? Number(args.offset) : undefined,
				});
				if (args.sync) {
					const syncResult = await syncAndPersist(
						db,
						client,
						listProjectIds(),
						false,
					);
					out({
						synced: countSyncData(syncResult),
						tasks: db.selectTasksByFilters(fields),
					});
				} else {
					out(db.selectTasksByFilters(fields));
				}
			},
		}),
		get: defineCommand({
			meta: { description: "Get a single task by id" },
			args: {
				id: { type: "positional", description: "task id", required: true },
			},
			run({ args }) {
				const task = db.selectTaskById(args.id);
				if (!task) {
					throw new Error("task not found");
				}
				out(task);
			},
		}),
		delete: defineCommand({
			meta: { description: "Not supported — complete the task instead" },
			args: {
				id: { type: "positional", description: "task id", required: true },
			},
			run() {
				throw new Error(
					'delete is not supported — use "tasks complete <id>" instead',
				);
			},
		}),
		complete: defineCommand({
			meta: { description: "Mark a task complete in Todoist" },
			args: {
				id: { type: "positional", description: "task id", required: true },
			},
			async run({ args }) {
				out(await completeTask(db, client, args.id));
			},
		}),
		update: defineCommand({
			meta: { description: "Update a task in Todoist" },
			args: {
				id: { type: "positional", description: "task id", required: true },
				title: { type: "string", description: "new task title" },
				due: {
					type: "string",
					description: 'due date (natural language: "tomorrow", "2026-05-10")',
				},
				priority: { type: "string", description: "priority 1-4 (4=urgent)" },
				label: { type: "string", description: "add a label" },
				removeLabel: { type: "string", description: "remove a label" },
				description: { type: "string", description: "task description" },
			},
			async run({ args }) {
				const fields = parseUpdateTaskFields({
					...args,
					addLabels: args.label ? [args.label] : undefined,
					removeLabels: args.removeLabel ? [args.removeLabel] : undefined,
				});
				out(await updateTask(db, client, args.id, fields));
			},
		}),
		add: defineCommand({
			meta: { description: "Add a new task to Todoist" },
			args: {
				title: { type: "string", description: "task title", required: true },
				project: { type: "string", description: "project id" },
				projectName: {
					type: "string",
					description: "project name (resolved to id via local db)",
				},
				due: {
					type: "string",
					description: 'due date (natural language: "tomorrow", "2026-05-10")',
				},
				priority: { type: "string", description: "priority 1-4 (4=urgent)" },
				label: { type: "string", description: "label name" },
			},
			async run({ args }) {
				const fields = parseAddTaskFields({
					...args,
					labels: args.label ? [args.label] : undefined,
				});
				out(await addTask(db, client, fields));
			},
		}),
	},
});

const main = defineCommand({
	meta: {
		name: "doist",
		description: "Sync Todoist tasks to SQLite for AI agent consumption",
		version: "0.1.0",
	},
	subCommands: {
		sync: syncCmd,
		projects: projectsCmd,
		sections: sectionsCmd,
		labels: labelsCmd,
		tasks: tasksCmd,
	},
});

const executableName = basename(process.execPath);

try {
	await tracer.startActiveSpan(executableName, async (span) => {
		try {
			await runMain(main);
		} catch (err) {
			span.recordException(err as Error);
			span.setAttribute(
				ATTR_ERROR_TYPE,
				err instanceof Error ? err.name : String(err),
			);
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(JSON.stringify({ error: message }) + "\n");
			process.exitCode = 1;
		} finally {
			span.setAttribute(ATTR_EXITCODE, process.exitCode ?? 0);
			span.end();
		}
	});
} finally {
	container.close();
	await shutdown().catch(console.error);
}
