import { defineCommand } from "citty";

export function buildCommand() {
	return defineCommand({
		meta: { description: "Not supported — complete the task instead" },
		args: {
			id: { type: "positional", description: "task id", required: true },
		},
		run() {
			throw new Error(
				'delete is not supported — use "tasks complete <id>" instead',
			);
		},
	});
}
