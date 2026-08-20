import { defineCommand } from "citty";
import {
	parseUpdateFilterFields,
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
			name: { type: "string", description: "new filter name" },
			query: { type: "string", description: "new filter query" },
			color: { type: "string", description: "new filter color" },
			"item-order": { type: "string", description: "new filter order" },
			"is-favorite": {
				type: "boolean",
				description: "set favorite status",
			},
			sync: { type: "boolean", description: "sync before updating" },
		},
		async run({ args }) {
			if (args.sync) {
				await container.sync(container.listProjectIds(), false);
			}
			const fields = parseUpdateFilterFields({
				name: args.name ?? undefined,
				query: args.query ?? undefined,
				color: args.color ?? undefined,
				itemOrder: args["item-order"] ? Number(args["item-order"]) : undefined,
				isFavorite: args["is-favorite"] ?? undefined,
			});
			const result = await operations.updateFilter(args.id, fields);
			out(result);
		},
	});
}
