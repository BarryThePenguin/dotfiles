import { defineCommand } from "citty";
import type { OperationalContainer, TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "Delete a saved filter" },
		args: {
			id: { type: "positional", description: "filter id", required: true },
			sync: { type: "boolean", description: "sync before deleting" },
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			await operations.deleteFilter(args.id);
			out({ ok: true, deleted: args.id });
		},
	});
}
