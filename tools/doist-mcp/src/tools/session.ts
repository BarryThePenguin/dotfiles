import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { filterByEnergy } from "doist-core";
import type { Container } from "doist-core";
import {
	createEnricher,
	FormattedTaskSchema,
	maybeSyncSummary,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

const SessionSummaryInputSchema = toStandardJsonSchema(
	v.object({
		energy: v.optional(v.picklist(["low", "medium", "high"] as const)),
		sync: v.optional(v.boolean(), false),
	}),
);

const SessionSummaryOutputSchema = toStandardJsonSchema(
	v.object({
		sync: v.optional(SyncSummarySchema),
		overdue: v.array(FormattedTaskSchema),
		today: v.array(FormattedTaskSchema),
		thoughtsCount: v.number(),
		requiresTriage: v.boolean(),
		suggested: v.array(FormattedTaskSchema),
		syncedAt: v.nullable(v.string()),
	}),
);

const TRIAGE_THRESHOLD = 5;

export function registerSessionTools(
	mcp: McpServer,
	container: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_session_summary",
		config: {
			description:
				"Aggregate check-in data: overdue tasks, today's tasks, thoughts count, and energy-matched suggestions. Use at the start of a check-in session instead of separate list calls.",
			inputSchema: SessionSummaryInputSchema,
			annotations: { readOnlyHint: true },
			outputSchema: SessionSummaryOutputSchema,
		},
		spanOptions: (args: {
			energy?: "low" | "medium" | "high" | undefined;
		}) => ({
			attributes: { energy: args.energy ?? "none" },
		}),
		callback: async ({ energy, sync: shouldSync }) => {
			const { db, client, listProjectIds } = container;
			const sync = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);

			const enrich = createEnricher(db);

			const overdue = db.selectTasks({ due: "overdue" }).map(enrich);
			const today = db.selectTasks({ due: "today" }).map(enrich);
			const thoughts = db.selectTasks({ label: "thoughts" });
			const requiresTriage = overdue.length > TRIAGE_THRESHOLD;
			const suggested = energy
				? filterByEnergy(db.selectTasks(), energy).map(enrich)
				: [];
			const syncedAt = db.getLastSyncedAt();

			return {
				data: {
					sync,
					overdue,
					today,
					thoughtsCount: thoughts.length,
					requiresTriage,
					suggested,
					syncedAt,
				},
				text: `${overdue.length} overdue, ${today.length} today, ${thoughts.length} thoughts${requiresTriage ? " — triage needed" : ""}`,
				track: {
					"overdue.count": overdue.length,
					"today.count": today.length,
					"thoughts.count": thoughts.length,
					"requires.triage": requiresTriage ? 1 : 0,
					"energy.provided": energy ? 1 : 0,
					"suggested.count": suggested.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});
}
