import { defineCommand } from "citty";
import { type OperationalContainer } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Get a single task by id" },
		args: {
			id: { type: "positional", description: "task id", required: true },
		},
		run({ args }) {
			const { db } = container;
			const task = db.getTaskById(args.id);
			if (!task) {
				throw new Error("task not found");
			}
			out(task);
		},
	});
}
