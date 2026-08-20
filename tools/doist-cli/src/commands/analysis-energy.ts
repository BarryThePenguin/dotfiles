import { defineCommand } from "citty";
import {
	countSyncData,
	type OperationalContainer,
	type SyncResult,
} from "doist-core";
import { findMissingEnergyMetadata } from "doist-core/analysis";
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
			const { db } = container;
			let sync: SyncResult | undefined;
			if (args.sync) {
				sync = countSyncData(
					await container.sync(container.listProjectIds(), false),
				);
			}
			const tasks = findMissingEnergyMetadata(db.selectTasks());
			out({ sync, tasks, syncedAt: db.getLastSyncedAt() });
		},
	});
}
