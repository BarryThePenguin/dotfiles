import { defineCommand } from "citty";
import { UpdateTaskCliFields, type TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(operations: TodoistOperations) {
	return defineCommand({
		meta: { description: "Update a task in Todoist" },
		args: {
			id: { type: "positional", description: "task id", required: true },
			...UpdateTaskCliFields.args,
		},
		async run({ args }) {
			const fields = UpdateTaskCliFields.read(args);
			out(await operations.updateTask(args.id, fields));
		},
	});
}
