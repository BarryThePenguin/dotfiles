import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import {
	findDuplicateCandidates,
	findMissingEnergyMetadata,
	findStaleCandidates,
	groupStaleByProject,
} from "../analysis/index.ts";
import type { Container } from "../container.ts";
import {
	buildProjectMap,
	FormattedTaskSchema,
	maybeSyncSummary,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

const EmptyInput = v.object({ sync: v.optional(v.boolean(), false) });

const TriageCategorySchema = v.nullable(
	v.picklist([
		"duplicates",
		"stale",
		"unroutedInbox",
		"missingEnergyMetadata",
	] as const),
);

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
	"reschedule",
	"schedule",
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

const StaleProjectGroupSchema = v.object({
	projectId: v.string(),
	projectName: v.string(),
	candidates: v.array(StaleCandidateSchema),
});

const StaleAnalysisSchema = v.object({
	candidates: v.array(StaleCandidateSchema),
	byProject: v.array(StaleProjectGroupSchema),
});

const DuplicateAnalysisOutputSchema = toStandardJsonSchema(
	v.object({
		sync: v.optional(SyncSummarySchema),
		...DuplicateAnalysisSchema.entries,
	}),
);

const TriageAnalysisOutputSchema = toStandardJsonSchema(
	v.object({
		sync: v.optional(SyncSummarySchema),
		duplicates: v.object({
			...DuplicateAnalysisSchema.entries,
		}),
		stale: v.object({
			...StaleAnalysisSchema.entries,
		}),
		unroutedInbox: v.array(FormattedTaskSchema),
		missingEnergyMetadata: v.array(FormattedTaskSchema),
		requiresAttention: v.boolean(),
		recommendedStartCategory: TriageCategorySchema,
		syncedAt: v.nullable(v.string()),
	}),
);

type TriageCategory = "duplicates" | "stale" | "unroutedInbox" | "missingEnergyMetadata";

function pickBestTriageCategory(
	duplicates: number,
	stale: number,
	unrouted: number,
	missingEnergy: number,
): TriageCategory | null {
	const entries: [TriageCategory, number][] = [
		["duplicates", duplicates],
		["stale", stale],
		["unroutedInbox", unrouted],
		["missingEnergyMetadata", missingEnergy],
	];
	const best = entries.reduce<[TriageCategory, number] | null>(
		(acc, cur) => (acc === null || cur[1] > acc[1] ? cur : acc),
		null,
	);
	return best && best[1] > 0 ? best[0] : null;
}

export function registerAnalysisTools(
	mcp: McpServer,
	container: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_triage_analysis",
		config: {
			description:
				"Aggregate triage analysis: duplicates, stale tasks, unrouted inbox items, and tasks missing energy metadata. Run once at the start of a triage session.",
			inputSchema: toStandardJsonSchema(EmptyInput),
			annotations: { readOnlyHint: true },
			outputSchema: TriageAnalysisOutputSchema,
		},
		spanOptions: {},
		callback: async ({ sync: shouldSync }) => {
			const { db, client, listProjectIds } = container;
			const sync = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);

			const allTasks = db.selectTasks();
			const duplicates = findDuplicateCandidates(allTasks);
			const projects = db.selectProjects();
			const projectMap = buildProjectMap(projects);
			const enrich = <T extends { projectId: string | null }>(t: T) => ({
				...t,
				projectName: t.projectId ? (projectMap.get(t.projectId) ?? null) : null,
			});

			const [inboxProject] = projects.filter((p) => p.isInbox);
			const inboxId = inboxProject?.id ?? null;
			const stale = findStaleCandidates(allTasks, inboxId);
			const enrichedStaleCandidates = stale.candidates.map((c) => ({
				...c,
				task: enrich(c.task),
			}));
			const staleByProject = groupStaleByProject(enrichedStaleCandidates, projects);
			const enrichedDuplicates = {
				...duplicates,
				groups: duplicates.groups.map((g) => ({
					...g,
					canonicalTask: enrich(g.canonicalTask),
					matches: g.matches.map((m) => ({ ...m, task: enrich(m.task) })),
				})),
			};
			const unroutedInbox = inboxId
				? db
						.selectTasks({ projectId: inboxId })
						.filter((t) => !t.labels.includes("thoughts"))
						.map(enrich)
				: [];
			const missingEnergyMetadata = findMissingEnergyMetadata(allTasks).map(enrich);
			const requiresAttention =
				duplicates.groups.length > 0 ||
				stale.candidates.length > 0 ||
				unroutedInbox.length > 0 ||
				missingEnergyMetadata.length > 0;
			const recommendedStartCategory = pickBestTriageCategory(
				enrichedDuplicates.groups.length,
				stale.candidates.length,
				unroutedInbox.length,
				missingEnergyMetadata.length,
			);
			const syncedAt = db.getLastSyncedAt();

			return {
				data: {
					sync,
					duplicates: enrichedDuplicates,
					stale: { ...stale, candidates: enrichedStaleCandidates, byProject: staleByProject },
					unroutedInbox,
					missingEnergyMetadata,
					requiresAttention,
					recommendedStartCategory,
					syncedAt,
				},
				text: `Triage: ${duplicates.groups.length} duplicates, ${stale.candidates.length} stale, ${unroutedInbox.length} unrouted, ${missingEnergyMetadata.length} missing energy`,
				track: {
					"duplicates.groups": duplicates.groups.length,
					"stale.candidates": stale.candidates.length,
					"unrouted.count": unroutedInbox.length,
					"missingEnergy.count": missingEnergyMetadata.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

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
			const projectMap = buildProjectMap(db.selectProjects());
			const enrich = <T extends { projectId: string | null }>(t: T) => ({
				...t,
				projectName: t.projectId ? (projectMap.get(t.projectId) ?? null) : null,
			});
			const analysis = findDuplicateCandidates(db.selectTasks());
			const enrichedGroups = analysis.groups.map((g) => ({
				...g,
				canonicalTask: enrich(g.canonicalTask),
				matches: g.matches.map((m) => ({ ...m, task: enrich(m.task) })),
			}));
			return {
				data: { sync: syncResult, ...analysis, groups: enrichedGroups },
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
			const projects = db.selectProjects();
			const projectMap = buildProjectMap(projects);
			const enrich = <T extends { projectId: string | null }>(t: T) => ({
				...t,
				projectName: t.projectId ? (projectMap.get(t.projectId) ?? null) : null,
			});
			const [inboxProject] = projects.filter((p) => p.isInbox);
			const analysis = findStaleCandidates(tasks, inboxProject?.id ?? null);
			const enrichedCandidates = analysis.candidates.map((c) => ({
				...c,
				task: enrich(c.task),
			}));
			const byProject = groupStaleByProject(enrichedCandidates, projects);
			return {
				data: { sync: syncResult, ...analysis, candidates: enrichedCandidates, byProject },
				text: `Found ${analysis.candidates.length} stale candidates`,
				track: {
					"result.count": analysis.candidates.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});
}
