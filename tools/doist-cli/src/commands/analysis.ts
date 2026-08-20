import { defineCommand } from "citty";
import { type OperationalContainer } from "doist-core";
import * as duplicates from "./analysis-duplicates.ts";
import * as energy from "./analysis-energy.ts";
import * as stale from "./analysis-stale.ts";
import * as triage from "./analysis-triage.ts";

export function buildCommands(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Task analysis and triage" },
		subCommands: {
			triage: triage.buildCommand(container),
			duplicates: duplicates.buildCommand(container),
			stale: stale.buildCommand(container),
			energy: energy.buildCommand(container),
		},
	});
}
