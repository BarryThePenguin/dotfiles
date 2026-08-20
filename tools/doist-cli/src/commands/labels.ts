import { type OperationalContainer } from "doist-core";
import * as list from "./label-list.ts";
import { defineCommand } from "citty";

export function buildCommands(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Manage labels" },
		subCommands: {
			list: list.buildCommand(container),
		},
	});
}
