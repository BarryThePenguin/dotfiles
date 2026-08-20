import { defineCommand } from "citty";
import type { OperationalContainer, TodoistOperations } from "doist-core";
import * as add from "./task-add.ts";
import * as complete from "./task-complete.ts";
import * as del from "./task-delete.ts";
import * as get from "./task-get.ts";
import * as list from "./task-list.ts";
import * as move from "./task-move.ts";
import * as search from "./task-search.ts";
import * as taskComments from "./task-comments.ts";
import * as uncomplete from "./task-uncomplete.ts";
import * as update from "./task-update.ts";

export function buildCommands(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "Manage tasks" },
		subCommands: {
			list: list.buildCommand(container, operations),
			get: get.buildCommand(container),
			delete: del.buildCommand(),
			complete: complete.buildCommand(operations),
			uncomplete: uncomplete.buildCommand(operations),
			move: move.buildCommand(container, operations),
			update: update.buildCommand(operations),
			add: add.buildCommand(operations),
			search: search.buildCommand(container),
			comments: taskComments.buildCommands(container, operations),
		},
	});
}
