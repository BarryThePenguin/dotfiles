import { defineCommand } from "citty";
import {
	countSyncData,
	type OperationalContainer,
	type TodoistOperations,
} from "doist-core";
import { out } from "../output.ts";

export function buildCommand(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return defineCommand({
		meta: { description: "List all sections" },
		args: {
			project: { type: "string", description: "filter by project id" },
			sync: {
				type: "boolean",
				description: "sync before listing",
			},
		},
		async run({ args }) {
			const sections = operations.listSections(args.project);
			if (args.sync) {
				const syncResult = await container.sync(
					container.listProjectIds(),
					false,
				);

				out({
					synced: countSyncData(syncResult),
					sections,
				});
			} else {
				out(sections);
			}
		},
	});
}
