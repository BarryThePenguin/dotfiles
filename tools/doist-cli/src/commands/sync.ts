import { defineCommand } from "citty";
import { countSyncData, type OperationalContainer } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Pull all data from Todoist into the local database" },
		args: {
			full: {
				type: "boolean",
				description: "reset sync token and perform a full re-fetch",
			},
		},
		async run({ args }) {
			const result = await container.sync(
				container.listProjectIds(),
				args.full ?? false,
			);
			out(countSyncData(result));
		},
	});
}
