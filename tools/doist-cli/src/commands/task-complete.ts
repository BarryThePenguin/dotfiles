import { defineCommand } from "citty";
import { type TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(operations: TodoistOperations) {
	return defineCommand({
		meta: { description: "Mark one or more tasks complete in Todoist" },
		args: {
			id: {
				type: "string",
				description: "task id or comma-separated ids",
				required: true,
			},
		},
		async run({ args }) {
			const ids = args.id.split(",").map((s) => s.trim());
			out(await operations.completeTasks(ids));
		},
	});
}
