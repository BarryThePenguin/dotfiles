import { defineCommand } from "citty";
import { type OperationalContainer, type TodoistOperations } from "doist-core";
import * as list from "./section-list.ts";

export function buildCommands(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "Manage sections" },
		subCommands: {
			list: list.buildCommand(container, operations),
		},
	});
}
