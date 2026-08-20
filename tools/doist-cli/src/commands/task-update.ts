import { defineCommand } from "citty";
import { parseUpdateTaskFields, type TodoistOperations } from "doist-core";
import { parseLabelList } from "../label-list.ts";
import { out } from "../output.ts";

export function buildCommand(operations: TodoistOperations) {
	return defineCommand({
		meta: { description: "Update a task in Todoist" },
		args: {
			id: { type: "positional", description: "task id", required: true },
			title: { type: "string", description: "new task title" },
			due: {
				type: "string",
				description: 'due date (natural language: "tomorrow", "2026-05-10")',
			},
			priority: { type: "string", description: "priority 1-4 (4=urgent)" },
			label: {
				type: "string",
				description:
					"label(s) to add; comma-separated for multiple (e.g. urgent,work)",
			},
			removeLabel: {
				type: "string",
				description:
					"label(s) to remove; comma-separated for multiple (e.g. urgent,work)",
			},
			description: { type: "string", description: "task description" },
		},
		async run({ args }) {
			const fields = parseUpdateTaskFields({
				...args,
				addLabels: parseLabelList(args.label),
				removeLabels: parseLabelList(args.removeLabel),
			});
			out(await operations.updateTask(args.id, fields));
		},
	});
}
