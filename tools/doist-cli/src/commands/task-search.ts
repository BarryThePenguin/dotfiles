import { defineCommand } from "citty";
import type { OperationalContainer } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Search incomplete tasks by keyword" },
		args: {
			query: {
				type: "positional",
				description: "search query",
				required: true,
			},
		},
		run({ args }) {
			const { queries } = container;
			const tasks = queries.selectTasks({ kind: "search", text: args.query });
			out({ tasks });
		},
	});
}
