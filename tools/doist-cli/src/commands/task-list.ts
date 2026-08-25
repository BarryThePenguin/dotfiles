import { defineCommand } from "citty";
import {
	countSyncData,
	type OperationalContainer,
	type TodoistOperations,
} from "doist-core";
import * as v from "valibot";
import { out } from "../output.ts";

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

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
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
			const { queries } = container;
			const { project, ...fields } = parseListTask(args);
			const projectId = project
				? operations.resolveProject(project)
				: undefined;
			const tasks =
				project && !projectId
					? []
					: queries.selectTasks({
							kind: "browse",
							...fields,
							...(projectId ? { projectId } : {}),
						});
			if (args.sync) {
				const syncResult = await container.sync(
					container.listProjectIds(),
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
	});
}
