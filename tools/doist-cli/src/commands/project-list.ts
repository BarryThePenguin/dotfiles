import { defineCommand } from "citty";
import { countSyncData, type OperationalContainer } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "List all projects" },
		args: {
			sync: {
				type: "boolean",
				description: "sync before listing",
			},
		},
		async run({ args }) {
			if (args.sync) {
				const { queries } = container;
				const syncResult = await container.sync(
					container.listProjectIds(),
					false,
				);
				out({
					synced: countSyncData(syncResult),
					projects: queries.selectProjects(),
				});
			} else {
				out(container.listProjects());
			}
		},
	});
}
