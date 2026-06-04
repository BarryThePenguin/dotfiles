import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import type { Container } from "../container.ts";
import { countSyncData, syncAndPersist } from "../sync.ts";
import { trackOperation } from "../telemetry.ts";
import { FullSyncInput, requireDb, SyncSummarySchema } from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

export function registerSyncTools(
	mcp: McpServer,
	{ db, client, listProjectIds }: Container,
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
			requireDb(db);
			const result = await syncAndPersist(db, client, listProjectIds(), full);
			const counts = countSyncData(result);
			trackOperation("todoist_sync", true, {
				"sync.full": full,
				"sync.projects": counts.projects,
				"sync.sections": counts.sections,
				"sync.labels": counts.labels,
				"sync.tasks": counts.tasks,
				"sync.reconciled": counts.reconciled,
			});
			return {
				content: [
					{
						type: "text",
						text: `Last synced at ${db.getLastSyncedAt()}`,
					},
				],
				structuredContent: counts,
			};
		},
	});
}
