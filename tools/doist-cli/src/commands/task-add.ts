import { defineCommand } from "citty";
import { AddTaskCliFields, type TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(operations: TodoistOperations) {
	return defineCommand({
		meta: { description: "Add a new task to Todoist" },
		args: {
			...AddTaskCliFields.args,
			projectName: {
				type: "string",
				description: "project name (resolved to id via local db)",
			},
		},
		async run({ args }) {
			const fields = AddTaskCliFields.read(args);
			out(await operations.addTask(fields));
		},
	});
}
