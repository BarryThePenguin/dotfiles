import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container, RestApiTaskByFilter } from "doist-core";
import {
	buildProjectMap,
	FormattedTaskSchema,
	maybeSyncSummary,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

const ENERGY_FILTERS: Record<string, string> = {
	low: "@low-energy | @quick",
	medium: "@low-energy | @medium-energy | @quick",
	high: "invalid-no-high-energy-tasks",
};

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

function toFormatted(
	task: RestApiTaskByFilter,
	projectMap: Map<string, string>,
) {
	return {
		id: task.id,
		url: `https://app.todoist.com/app/task/${task.id}`,
		projectId: task.project_id,
		sectionId: task.section_id,
		parentId: task.parent_id ?? null,
		childOrder: task.child_order ?? null,
		noteCount: task.note_count ?? null,
		updatedAt: task.updated_at ?? null,
		content: task.content,
		due: task.due
			? {
					date: task.due.date,
					string: task.due.string,
					isRecurring: task.due.is_recurring ?? false,
				}
			: null,
		isCompleted: task.checked ?? false,
		createdAt: task.added_at ?? null,
		labels: task.labels,
		priority: task.priority,
		description: task.description,
		projectName: task.project_id
			? (projectMap.get(task.project_id) ?? null)
			: null,
	};
}

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

			const projectMap = buildProjectMap(db.selectProjects());

			const [overdueResult, todayResult, thoughtsResult] = await Promise.all([
				client.fetchTasksByFilter("overdue", 200),
				client.fetchTasksByFilter("today", 200),
				client.fetchTasksByFilter("@thoughts", 200),
			]);

			const overdue = overdueResult.tasks
				.filter((t) => !t.is_deleted)
				.map((t) => toFormatted(t, projectMap));
			const today = todayResult.tasks
				.filter((t) => !t.is_deleted)
				.map((t) => toFormatted(t, projectMap));
			const thoughtsCount = thoughtsResult.tasks.filter(
				(t) => !t.is_deleted,
			).length;
			const requiresTriage = overdue.length > TRIAGE_THRESHOLD;

			let suggested: ReturnType<typeof toFormatted>[] = [];
			if (energy && energy !== "high") {
				const filter = ENERGY_FILTERS[energy];
				if (filter) {
					const energyResult = await client.fetchTasksByFilter(filter, 2);
					suggested = energyResult.tasks
						.filter((t) => !t.is_deleted)
						.map((t) => toFormatted(t, projectMap));
				}
			}

			const syncedAt = db.getLastSyncedAt();

			return {
				data: {
					sync,
					overdue,
					today,
					thoughtsCount,
					requiresTriage,
					suggested,
					syncedAt,
				},
				text: `${overdue.length} overdue, ${today.length} today, ${thoughtsCount} thoughts${requiresTriage ? " — triage needed" : ""}`,
				track: {
					"overdue.count": overdue.length,
					"today.count": today.length,
					"thoughts.count": thoughtsCount,
					"requires.triage": requiresTriage ? 1 : 0,
					"energy.provided": energy ? 1 : 0,
					"suggested.count": suggested.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});
}
