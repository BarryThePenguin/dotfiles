import { defineCommand } from "citty";
import {
	FilterQueryCliFields,
	type OperationalContainer,
	type TodoistOperations,
} from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: {
			description:
				"Run a filter query against Todoist and return matching tasks",
		},
		args: {
			...FilterQueryCliFields.args,
			sync: { type: "boolean", description: "sync before querying" },
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			const parsed = FilterQueryCliFields.read(args);
			const result = await operations.runFilterQuery(
				parsed.query,
				parsed.limit ?? 50,
			);
			out(result);
		},
	});
}
