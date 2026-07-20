#!/usr/bin/env node

import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import { defineCommand, runMain } from "citty";
import { basename } from "node:path";
import * as v from "valibot";
import {
	createContainer,
	addTask,
	completeTasks,
	uncompleteTasks,
	moveTask,
	updateTask,
	listSections,
	resolveProject,
	parseAddTaskFields,
	parseUpdateTaskFields,
	countSyncData,
	syncAndPersist,
	tracer,
	ATTR_EXITCODE,
	findDuplicateCandidates,
	findStaleCandidates,
	findMissingEnergyMetadata,
	groupStaleByProject,
	filterByEnergy,
} from "doist-core";
import { shutdown } from "./instrumentation.ts";
import { out } from "./output.ts";

const container = createContainer();
const { addProject, removeProject, listProjects, listProjectIds, client } =
	container;

const parseListTask = v.parser(
	v.object({
		project: v.exactOptional(v.string()),
		due: v.exactOptional(v.picklist(["today", "overdue"] as const)),
		priority: v.exactOptional(
			v.pipe(
				v.string(),
				v.toNumber(),
				v.integer(),
				v.minValue(1),
				v.maxValue(4),
			),
		),
		label: v.exactOptional(v.string()),
		limit: v.exactOptional(
			v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)),
		),
		offset: v.exactOptional(
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
		const { db } = container;
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
					const { db } = container;
					const syncResult = await syncAndPersist(
						db,
						client,
						listProjectIds(),
						false,
					);
					out({
						synced: countSyncData(syncResult),
						projects: db.selectProjects(),
					});
				} else {
					out(listProjects());
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
				const { db } = container;
				const sections = listSections(db, args.project);
				if (args.sync) {
					const syncResult = await syncAndPersist(
						db,
						client,
						listProjectIds(),
						false,
					);

					out({
						synced: countSyncData(syncResult),
						sections,
					});
				} else {
					out(sections);
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
				const { db } = container;
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
				const { db } = container;
				const { project, ...fields } = parseListTask(args);
				const projectId = project ? resolveProject(db, project) : undefined;
				const tasks =
					project && !projectId ? [] : db.selectTasks({ ...fields, projectId });
				if (args.sync) {
					const syncResult = await syncAndPersist(
						db,
						client,
						listProjectIds(),
						false,
					);
					out({
						synced: countSyncData(syncResult),
						tasks,
					});
				} else {
					out(tasks);
				}
			},
		}),
		get: defineCommand({
			meta: { description: "Get a single task by id" },
			args: {
				id: { type: "positional", description: "task id", required: true },
			},
			run({ args }) {
				const { db } = container;
				const task = db.getTaskById(args.id);
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
			meta: { description: "Mark one or more tasks complete in Todoist" },
			args: {
				id: {
					type: "string",
					description: "task id or comma-separated ids",
					required: true,
				},
			},
			async run({ args }) {
				const { db } = container;
				const ids = args.id.split(",").map((s) => s.trim());
				out(await completeTasks(db, client, ids));
			},
		}),
		uncomplete: defineCommand({
			meta: { description: "Mark one or more tasks incomplete in Todoist" },
			args: {
				id: {
					type: "string",
					description: "task id or comma-separated ids",
					required: true,
				},
			},
			async run({ args }) {
				const { db } = container;
				const ids = args.id.split(",").map((s) => s.trim());
				out(await uncompleteTasks(db, client, ids));
			},
		}),
		move: defineCommand({
			meta: { description: "Move a task to another project" },
			args: {
				id: { type: "positional", description: "task id", required: true },
				project: {
					type: "positional",
					description: "project id or name",
					required: true,
				},
			},
			async run({ args }) {
				const { db } = container;
				if (!db.getTaskById(args.id)) {
					throw new Error(`task not found: ${args.id}`);
				}
				out(await moveTask(db, client, args.id, args.project));
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
				const { db } = container;
				const fields = parseUpdateTaskFields({
					...args,
					addLabels: args.label ? [args.label] : undefined,
					removeLabels: args.removeLabel ? [args.removeLabel] : undefined,
				});
				out(await updateTask(db, client, args.id, fields));
			},
		}),
		search: defineCommand({
			meta: { description: "Search incomplete tasks by keyword" },
			args: {
				query: {
					type: "positional",
					description: "search query",
					required: true,
				},
			},
			run({ args }) {
				const { db } = container;
				const tasks = db.selectTasks({
					content: args.query,
					completed: "incomplete",
					orderBy: { field: "priority", direction: "desc" },
				});
				out({ tasks });
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
				const { db } = container;
				const fields = parseAddTaskFields({
					...args,
					labels: args.label ? [args.label] : undefined,
				});
				out(await addTask(db, client, fields));
			},
		}),
	},
});

// ── analysis ──────────────────────────────────────────────────
const analysisCmd = defineCommand({
	meta: { description: "Task analysis and triage" },
	subCommands: {
		triage: defineCommand({
			meta: {
				description:
					"Aggregate triage: duplicates, stale tasks, unrouted inbox, missing energy metadata",
			},
			args: {
				sync: {
					type: "boolean",
					description: "sync before analysis",
				},
			},
			async run({ args }) {
				const { db } = container;
				let sync: ReturnType<typeof countSyncData> | undefined;
				if (args.sync) {
					sync = countSyncData(
						await syncAndPersist(db, client, listProjectIds(), false),
					);
				}

				const allTasks = db.selectTasks();
				const projects = db.selectProjects();
				const duplicates = findDuplicateCandidates(allTasks);
				const stale = findStaleCandidates(
					allTasks,
					projects.find((p) => p.isInbox)?.id ?? null,
				);
				const inboxId = projects.find((p) => p.isInbox)?.id ?? null;
				const unroutedInbox = inboxId
					? db
							.selectTasks({ projectId: inboxId })
							.filter((t) => !t.labels.includes("thoughts"))
					: [];
				const missingEnergy = findMissingEnergyMetadata(allTasks);
				const requiresAttention =
					duplicates.groups.length > 0 ||
					stale.candidates.length > 0 ||
					unroutedInbox.length > 0 ||
					missingEnergy.length > 0;

				out({
					sync,
					duplicates: {
						groups: duplicates.groups.length,
						exactGroups: duplicates.exactGroups,
						fuzzyGroups: duplicates.fuzzyGroups,
						candidates: duplicates.candidates,
					},
					stale: {
						candidates: stale.candidates.length,
						byProject: groupStaleByProject(stale.candidates, projects),
					},
					unroutedInbox: unroutedInbox.length,
					missingEnergyMetadata: missingEnergy.length,
					requiresAttention,
					syncedAt: db.getLastSyncedAt(),
				});
			},
		}),
		duplicates: defineCommand({
			meta: { description: "Find duplicate and near-duplicate tasks" },
			args: {
				sync: {
					type: "boolean",
					description: "sync before analysis",
				},
			},
			async run({ args }) {
				const { db } = container;
				let sync: ReturnType<typeof countSyncData> | undefined;
				if (args.sync) {
					sync = countSyncData(
						await syncAndPersist(db, client, listProjectIds(), false),
					);
				}
				const analysis = findDuplicateCandidates(db.selectTasks());
				out({ sync, ...analysis, syncedAt: db.getLastSyncedAt() });
			},
		}),
		stale: defineCommand({
			meta: { description: "Find stale or abandoned tasks" },
			args: {
				sync: {
					type: "boolean",
					description: "sync before analysis",
				},
			},
			async run({ args }) {
				const { db } = container;
				let sync: ReturnType<typeof countSyncData> | undefined;
				if (args.sync) {
					sync = countSyncData(
						await syncAndPersist(db, client, listProjectIds(), false),
					);
				}
				const projects = db.selectProjects();
				const inboxId = projects.find((p) => p.isInbox)?.id ?? null;
				const analysis = findStaleCandidates(
					db.selectTasks({
						orderBy: { field: "updated_at", direction: "asc" },
					}),
					inboxId,
				);
				const byProject = groupStaleByProject(analysis.candidates, projects);
				out({
					sync,
					...analysis,
					byProject,
					syncedAt: db.getLastSyncedAt(),
				});
			},
		}),
		energy: defineCommand({
			meta: {
				description: "Find tasks missing energy metadata (labels or priority)",
			},
			args: {
				sync: {
					type: "boolean",
					description: "sync before analysis",
				},
			},
			async run({ args }) {
				const { db } = container;
				let sync: ReturnType<typeof countSyncData> | undefined;
				if (args.sync) {
					sync = countSyncData(
						await syncAndPersist(db, client, listProjectIds(), false),
					);
				}
				const tasks = findMissingEnergyMetadata(db.selectTasks());
				out({ sync, tasks, syncedAt: db.getLastSyncedAt() });
			},
		}),
	},
});

// ── session ───────────────────────────────────────────────────
const TRIAGE_THRESHOLD = 5;

const sessionCmd = defineCommand({
	meta: { description: "Session check-in summaries" },
	subCommands: {
		summary: defineCommand({
			meta: {
				description:
					"Overdue, today, thoughts count, and energy-matched suggestions",
			},
			args: {
				energy: {
					type: "string",
					description: "energy level (low, medium, high)",
				},
				sync: {
					type: "boolean",
					description: "sync before summary",
				},
			},
			async run({ args }) {
				const { db } = container;
				let sync: ReturnType<typeof countSyncData> | undefined;
				if (args.sync) {
					sync = countSyncData(
						await syncAndPersist(db, client, listProjectIds(), false),
					);
				}

				const overdue = db.selectTasks({ due: "overdue" });
				const today = db.selectTasks({ due: "today" });
				const thoughts = db.selectTasks({ label: "thoughts" });
				const requiresTriage = overdue.length > TRIAGE_THRESHOLD;
				const suggested =
					args.energy && ["low", "medium", "high"].includes(args.energy)
						? filterByEnergy(
								db.selectTasks(),
								args.energy as "low" | "medium" | "high",
							)
						: [];

				out({
					sync,
					overdue,
					today,
					thoughtsCount: thoughts.length,
					requiresTriage,
					suggested,
					syncedAt: db.getLastSyncedAt(),
				});
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
		analysis: analysisCmd,
		session: sessionCmd,
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
