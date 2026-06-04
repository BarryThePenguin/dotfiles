import type { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container } from "../container.ts";
import type { AppTask } from "../schema.ts";
import {
	FormattedTaskSchema,
	maybeSyncSummary,
	requireDb,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

const ReviewInputSchema = toStandardJsonSchema(
	v.object({
		label: v.string(),
		sync: v.optional(v.boolean(), false),
	}),
);

const ReviewRecommendationSchema = v.picklist([
	"promote",
	"defer",
	"clarify",
	"complete",
] as const);

const ReviewCandidateSchema = v.object({
	task: FormattedTaskSchema,
	recommendationCode: ReviewRecommendationSchema,
	recommendationText: v.string(),
});

const ReviewAnalysisSchema = v.object({
	candidates: v.array(ReviewCandidateSchema),
});

const ReviewAnalysisOutputSchema = toStandardJsonSchema(
	v.object({
		sync: v.optional(SyncSummarySchema),
		...ReviewAnalysisSchema.entries,
	}),
);

function recommendAction(task: AppTask): { code: string; text: string } {
	// Simple heuristics: if task has only label, suggest clarify; if overdue, promote; else defer
	if (task.due && !task.isCompleted) {
		return { code: "promote", text: "Promote to next action" };
	}
	if (task.labels.length === 1) {
		return { code: "clarify", text: "Clarify or rewrite this thought" };
	}
	return { code: "defer", text: "Defer or complete if not actionable" };
}

export function registerReviewTool(
	mcp: McpServer,
	{ db, client, listProjectIds }: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_review",
		config: {
			description:
				"Review all active tasks with a given label for triage (promote, defer, clarify, complete)",
			inputSchema: ReviewInputSchema,
			annotations: {
				readOnlyHint: true,
			},
			outputSchema: ReviewAnalysisOutputSchema,
		},
		spanOptions: {},
		callback: async ({ label, sync: shouldSync }) => {
			requireDb(db);
			const sync = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);
			const tasks = db.selectTasks({ label });
			const candidates = tasks.map((task) => {
				const { code, text } = recommendAction(task);
				return {
					task,
					recommendationCode: code,
					recommendationText: text,
				};
			});
			return {
				content: [{ type: "text", text: "" }],
				structuredContent: { sync, candidates },
			};
		},
	});
}
