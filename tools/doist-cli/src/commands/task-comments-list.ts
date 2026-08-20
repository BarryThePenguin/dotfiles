import { defineCommand } from "citty";
import { type OperationalContainer, type TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommands(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "List comments for a task" },
		args: {
			task: {
				type: "positional",
				description: "task id",
				required: true,
			},
			sync: {
				type: "boolean",
				description: "sync before listing",
			},
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			out(operations.listTaskComments(args.task));
		},
	});
}
