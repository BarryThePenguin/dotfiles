import { defineCommand } from "citty";
import type { OperationalContainer, TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "List all saved filters" },
		args: {
			sync: {
				type: "boolean",
				description: "sync before listing",
			},
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			out(operations.listFilters());
		},
	});
}
