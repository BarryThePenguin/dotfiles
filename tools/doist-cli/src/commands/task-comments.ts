import { defineCommand } from "citty";
import { type OperationalContainer, type TodoistOperations } from "doist-core";
import * as add from "./task-comments-add.ts";
import * as list from "./task-comments-list.ts";

export function buildCommands(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "Manage task comments" },
		subCommands: {
			add: add.buildCommands(operations),
			list: list.buildCommands(container, operations),
		},
	});
}
