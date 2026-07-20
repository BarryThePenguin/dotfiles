import * as v from "valibot";
import type { AppProject, Database, TodoistClient } from "doist-core";
import { countSyncData, syncAndPersist } from "doist-core";

export const EmptyInput = v.object({ sync: v.optional(v.boolean(), false) });
export const SyncInput = v.object({ sync: v.optional(v.boolean(), false) });
export const FullSyncInput = v.object({ full: v.optional(v.boolean(), false) });

export const SectionsListInput = v.object({
	project: v.optional(v.string()),
	...SyncInput.entries,
});

export const FormattedTaskSchema = v.object({
	id: v.string(),
	url: v.string(),
	projectId: v.nullable(v.string()),
	sectionId: v.nullable(v.string()),
	parentId: v.nullable(v.string()),
	childOrder: v.nullable(v.number()),
	noteCount: v.nullable(v.number()),
	updatedAt: v.nullable(v.string()),
	content: v.string(),
	due: v.nullable(
		v.object({
			date: v.string(),
			string: v.string(),
			isRecurring: v.boolean(),
		}),
	),
	isCompleted: v.boolean(),
	createdAt: v.nullable(v.string()),
	labels: v.array(v.string()),
	priority: v.nullable(v.number()),
	description: v.nullable(v.string()),
	projectName: v.optional(v.nullable(v.string())),
});

export const ListTaskItemSchema = v.union([
	FormattedTaskSchema,
	v.pick(FormattedTaskSchema, ["id", "content"]),
]);

export type ListTaskItem = v.InferOutput<typeof ListTaskItemSchema>;

export const ListLabelSchema = v.object({
	id: v.string(),
	name: v.string(),
});

export const SectionSchema = v.object({
	id: v.string(),
	projectId: v.string(),
	name: v.string(),
	sectionOrder: v.nullable(v.number()),
});

export const SyncSummarySchema = v.object({
	projects: v.number(),
	sections: v.number(),
	labels: v.number(),
	tasks: v.number(),
	reconciled: v.number(),
});

export function buildProjectMap(projects: AppProject[]): Map<string, string> {
	return new Map(projects.map((p) => [p.id, p.name]));
}

export function createEnricher(db: Database) {
	const projectMap = buildProjectMap(db.selectProjects());
	return <T extends { projectId: string | null }>(t: T) => ({
		...t,
		projectName: t.projectId ? (projectMap.get(t.projectId) ?? null) : null,
	});
}

export async function maybeSyncSummary(
	db: Database,
	client: TodoistClient,
	listProjectIds: () => string[],
	sync?: boolean,
) {
	if (!sync) {
		return undefined;
	}
	const result = await syncAndPersist(db, client, listProjectIds(), false);
	return countSyncData(result);
}
