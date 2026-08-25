import { defineCommand } from "citty";
import { countSyncData, type OperationalContainer } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "List all labels" },
		args: {
			sync: {
				type: "boolean",
				description: "sync before listing",
			},
		},
		async run({ args }) {
			const { queries } = container;
			if (args.sync) {
				const syncResult = await container.sync(
					container.listProjectIds(),
					false,
				);
				out({
					synced: countSyncData(syncResult),
					labels: queries.selectAllLabels(),
				});
			} else {
				out(queries.selectAllLabels());
			}
		},
	});
}
