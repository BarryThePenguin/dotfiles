import { defineCommand } from "citty";
import {
	parseAddFilterFields,
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
			name: {
				type: "positional",
				description: "filter name",
				required: true,
			},
			query: {
				type: "positional",
				description: "filter query (Todoist syntax)",
				required: true,
			},
			color: { type: "string", description: "filter color" },
			"item-order": {
				type: "string",
				description: "filter order position",
			},
			"is-favorite": { type: "boolean", description: "mark as favorite" },
			sync: { type: "boolean", description: "sync before adding" },
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			const fields = parseAddFilterFields({
				name: args.name,
				query: args.query,
				color: args.color ?? undefined,
				itemOrder: args["item-order"] ? Number(args["item-order"]) : undefined,
				isFavorite: args["is-favorite"] ?? undefined,
			});
			const result = await operations.addFilter(fields);
			out(result);
		},
	});
}
