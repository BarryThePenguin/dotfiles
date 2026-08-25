import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import type { OperationalContainer } from "doist-core";
import { countSyncData } from "doist-core";
import { FullSyncInput, SyncSummarySchema } from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

export function registerSyncTools(
	mcp: McpServer,
	container: OperationalContainer,
): void {
	registerTool({
		mcp,
		name: "todoist_sync",
		config: {
			description: "Pull all Todoist data into the local database",
			inputSchema: toStandardJsonSchema(FullSyncInput),
			outputSchema: toStandardJsonSchema(SyncSummarySchema),
		},
		spanOptions: (args: { full?: boolean }) => ({
			attributes: { "sync.full": args.full },
		}),
		callback: async ({ full }) => {
			const result = await container.sync(container.listProjectIds(), full);
			const counts = countSyncData(result);
			return {
				data: counts,
				text: `Last synced at ${container.queries.getLastSyncedAt()}`,
				track: {
					"sync.full": full,
					"sync.projects": counts.projects,
					"sync.sections": counts.sections,
					"sync.labels": counts.labels,
					"sync.tasks": counts.tasks,
					"sync.reconciled": counts.reconciled,
				},
			};
		},
	});
}
