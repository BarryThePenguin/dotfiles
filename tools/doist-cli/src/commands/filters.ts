import { defineCommand } from "citty";
import { type OperationalContainer, type TodoistOperations } from "doist-core";
import * as add from "./filter-add.ts";
import * as del from "./filter-delete.ts";
import * as list from "./filter-list.ts";
import * as query from "./filter-query.ts";
import * as update from "./filter-update.ts";

export function buildCommands(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "Manage saved filters" },
		subCommands: {
			list: list.buildCommand(container, operations),
			add: add.buildCommand(container, operations),
			update: update.buildCommand(container, operations),
			delete: del.buildCommand(container, operations),
			query: query.buildCommand(container, operations),
		},
	});
}
