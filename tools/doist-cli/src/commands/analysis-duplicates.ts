import { defineCommand } from "citty";
import {
	countSyncData,
	type OperationalContainer,
	type SyncResult,
} from "doist-core";
import { findDuplicateCandidates } from "doist-core/analysis";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Find duplicate and near-duplicate tasks" },
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
			const analysis = findDuplicateCandidates(
				queries.selectTasks({ kind: "browse" }),
			);
			out({ sync, ...analysis, syncedAt: queries.getLastSyncedAt() });
		},
	});
}
