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
			const { db } = container;
			const tasks = db.selectTasks({
				content: args.query,
				completed: "incomplete",
				orderBy: { field: "priority", direction: "desc" },
				projectScope: container.listProjectIds(),
			});
			out({ tasks });
		},
	});
}
