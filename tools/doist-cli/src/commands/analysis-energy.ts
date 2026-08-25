import { defineCommand } from "citty";
import {
	countSyncData,
	type OperationalContainer,
	type SyncResult,
} from "doist-core";
import { findMissingEnergyMetadata } from "doist-personal";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: {
			description: "Find tasks missing energy metadata (labels or priority)",
		},
		args: {
			sync: {
				type: "boolean",
				description: "sync before analysis",
			},
		},
		async run({ args }) {
			const { queries } = container;
			let sync: SyncResult | undefined;
			if (args.sync) {
				sync = countSyncData(
					await container.sync(container.listProjectIds(), false),
				);
			}
			const tasks = findMissingEnergyMetadata(
				queries.selectTasks({ kind: "browse" }),
			);
			out({ sync, tasks, syncedAt: queries.getLastSyncedAt() });
		},
	});
}
