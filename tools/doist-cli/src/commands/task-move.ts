import { defineCommand } from "citty";
import type { OperationalContainer, TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
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
			out(await operations.moveTask(args.id, args.project));
		},
	});
}
