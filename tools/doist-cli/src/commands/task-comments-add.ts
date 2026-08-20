import { defineCommand } from "citty";
import { parseAddCommentFields, type TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommands(operations: TodoistOperations) {
	return defineCommand({
		meta: { description: "Add a comment to a task" },
		args: {
			task: {
				type: "positional",
				description: "task id",
				required: true,
			},
			content: {
				type: "positional",
				description: "comment content",
				required: true,
			},
		},
		async run({ args }) {
			const fields = parseAddCommentFields({
				taskId: args.task,
				content: args.content,
			});
			out(await operations.addTaskComment(fields.taskId, fields.content));
		},
	});
}
