import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import type { Container } from "../container.ts";
import { countSyncData, syncAndPersist } from "../sync.ts";
import { FullSyncInput, SyncSummarySchema } from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

export function registerSyncTools(
	mcp: McpServer,
	container: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_sync",
		config: {
			description: "Pull all Todoist data into the local database",
			inputSchema: toStandardJsonSchema(FullSyncInput),
			outputSchema: toStandardJsonSchema(SyncSummarySchema),
		},
		spanOptions: ({ full }) => ({ attributes: { "sync.full": full } }),
		callback: async ({ full }) => {
			const { db, client, listProjectIds } = container;
			const result = await syncAndPersist(db, client, listProjectIds(), full);
			const counts = countSyncData(result);
			return {
				data: counts,
				text: `Last synced at ${db.getLastSyncedAt()}`,
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
