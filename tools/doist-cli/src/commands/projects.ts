import { defineCommand } from "citty";
import type { OperationalContainer } from "doist-core";
import * as add from "./project-add.ts";
import * as list from "./project-list.ts";
import * as remove from "./project-remove.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Manage projects" },
		subCommands: {
			list: list.buildCommand(container),
			add: add.buildCommand(container),
			remove: remove.buildCommand(container),
		},
	});
}
