import { defineCommand } from "citty";
import {
	UpdateFilterCliFields,
	type OperationalContainer,
	type TodoistOperations,
} from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "Update an existing saved filter" },
		args: {
			id: { type: "positional", description: "filter id", required: true },
			...UpdateFilterCliFields.args,
			sync: { type: "boolean", description: "sync before updating" },
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			const fields = UpdateFilterCliFields.read(args);
			const result = await operations.updateFilter(args.id, fields);
			out(result);
		},
	});
}
