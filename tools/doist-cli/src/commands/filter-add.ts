import { defineCommand } from "citty";
import {
	AddFilterCliFields,
	type OperationalContainer,
	type TodoistOperations,
} from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "Create a new saved filter" },
		args: {
			...AddFilterCliFields.args,
			sync: { type: "boolean", description: "sync before adding" },
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			const fields = AddFilterCliFields.read(args);
			const result = await operations.addFilter(fields);
			out(result);
		},
	});
}
