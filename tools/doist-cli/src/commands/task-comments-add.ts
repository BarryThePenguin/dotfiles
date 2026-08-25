import { defineCommand } from "citty";
import { AddCommentCliFields, type TodoistOperations } from "doist-core";
import { out } from "../output.ts";

export function buildCommands(operations: TodoistOperations) {
	return defineCommand({
		meta: { description: "Add a comment to a task" },
		args: AddCommentCliFields.args,
		async run({ args }) {
			const fields = AddCommentCliFields.read(args);
			out(await operations.addTaskComment(fields.taskId, fields.content));
		},
	});
}
