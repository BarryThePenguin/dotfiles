import { defineCommand } from "citty";
import {
	parseFilterQueryInput,
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
			query: {
				type: "positional",
				description: "filter query (Todoist syntax)",
				required: true,
			},
			limit: {
				type: "string",
				description: "max tasks to return (1-200, default 50)",
			},
			sync: { type: "boolean", description: "sync before querying" },
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			const parsed = parseFilterQueryInput({
				query: args.query,
				limit: args.limit ? Number(args.limit) : undefined,
			});
			const result = await operations.runFilterQuery(
				parsed.query,
				parsed.limit ?? 50,
			);
			out(result);
		},
	});
}
