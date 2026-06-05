import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import {
	findDuplicateCandidates,
	findStaleCandidates,
} from "../analysis/index.ts";
import type { Container } from "../container.ts";
import {
	FormattedTaskSchema,
	maybeSyncSummary,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

const EmptyInput = v.object({ sync: v.optional(v.boolean(), false) });

const DuplicateAnalysisInputSchema = toStandardJsonSchema(EmptyInput);

const DuplicateMatchTypeSchema = v.picklist(["exact", "fuzzy"] as const);
const DuplicateRecommendationSchema = v.picklist([
	"merge",
	"review",
	"ignore",
] as const);
const StaleRecommendationSchema = v.picklist([
	"complete",
	"rewrite",
	"defer",
	"keep",
] as const);

const DuplicateMatchSchema = v.object({
	task: FormattedTaskSchema,
	similarity: v.number(),
});

const DuplicateGroupSchema = v.object({
	canonicalTask: FormattedTaskSchema,
	matches: v.array(DuplicateMatchSchema),
	matchType: DuplicateMatchTypeSchema,
	score: v.number(),
	reason: v.string(),
	recommendationCode: DuplicateRecommendationSchema,
	recommendationText: v.string(),
});

const DuplicateAnalysisSchema = v.object({
	groups: v.array(DuplicateGroupSchema),
	candidates: v.number(),
	exactGroups: v.number(),
	fuzzyGroups: v.number(),
});

const StaleCandidateSchema = v.object({
	task: FormattedTaskSchema,
	signals: v.array(v.string()),
	score: v.number(),
	recommendationCode: StaleRecommendationSchema,
	recommendationText: v.string(),
});

const StaleAnalysisSchema = v.object({
	candidates: v.array(StaleCandidateSchema),
});

const DuplicateAnalysisOutputSchema = toStandardJsonSchema(
	v.object({
		sync: v.optional(SyncSummarySchema),
		...DuplicateAnalysisSchema.entries,
	}),
);

export function registerAnalysisTools(
	mcp: McpServer,
	container: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_find_duplicates",
		config: {
			description: "Find duplicate and near-duplicate active tasks",
			inputSchema: DuplicateAnalysisInputSchema,
			annotations: {
				readOnlyHint: true,
			},
			outputSchema: DuplicateAnalysisOutputSchema,
		},
		spanOptions: {},
		callback: async ({ sync: shouldSync }) => {
			const { db, client, listProjectIds } = container;
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);
			const analysis = findDuplicateCandidates(db.selectTasks());
			return {
				data: { sync: syncResult, ...analysis },
				text: `Found ${analysis.groups.length} duplicate groups`,
				track: {
					"result.groups": analysis.groups.length,
					"result.fuzzyGroups": analysis.fuzzyGroups,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_find_stale_tasks",
		config: {
			description: "Find active tasks that look stale or ready to rewrite",
			inputSchema: toStandardJsonSchema(EmptyInput),
			annotations: {
				readOnlyHint: true,
			},
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
					...StaleAnalysisSchema.entries,
				}),
			),
		},
		spanOptions: {},
		callback: async ({ sync: shouldSync }) => {
			const { db, client, listProjectIds } = container;
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);
			const tasks = db.selectTasks({
				orderBy: { field: "updated_at", direction: "asc" },
			});
			const [inboxProject] = db.selectProjects({ isInbox: true });
			const analysis = findStaleCandidates(tasks, inboxProject?.id ?? null);
			return {
				data: { sync: syncResult, ...analysis },
				text: `Found ${analysis.candidates.length} stale candidates`,
				track: {
					"result.count": analysis.candidates.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});
}
