import { defineCommand } from "citty";
import { parseAddTaskFields, type TodoistOperations } from "doist-core";
import { out } from "../output.ts";
import { parseLabelList } from "../label-list.ts";

export function buildCommand(operations: TodoistOperations) {
	return defineCommand({
		meta: { description: "Add a new task to Todoist" },
		args: {
			title: { type: "string", description: "task title", required: true },
			project: { type: "string", description: "project id" },
			projectName: {
				type: "string",
				description: "project name (resolved to id via local db)",
			},
			parent: {
				type: "string",
				description: "parent task id (creates a subtask)",
			},
			due: {
				type: "string",
				description: 'due date (natural language: "tomorrow", "2026-05-10")',
			},
			priority: { type: "string", description: "priority 1-4 (4=urgent)" },
			label: {
				type: "string",
				description:
					"label name(s); comma-separated for multiple (e.g. urgent,work)",
			},
			description: { type: "string", description: "task description" },
		},
		async run({ args }) {
			const fields = parseAddTaskFields({
				...args,
				labels: parseLabelList(args.label),
				parentId: args.parent ?? undefined,
			});
			out(await operations.addTask(fields));
		},
	});
}
