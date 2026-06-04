import * as v from "valibot";
import type { Database } from "../db.ts";
import { countSyncData, syncAndPersist } from "../sync.ts";
import type { TodoistClient } from "../todoist.ts";

export const EmptyInput = v.object({ sync: v.optional(v.boolean(), false) });
export const IdInput = v.object({ id: v.string() });
export const IdOrIdsInput = v.object({
	id: v.union([v.string(), v.array(v.string())]),
});
export const SyncInput = v.object({ sync: v.optional(v.boolean(), false) });
export const FullSyncInput = v.object({ full: v.optional(v.boolean(), false) });

export const ReportErrorInput = v.object({
	toolName: v.string(),
	error: v.string(),
	requestId: v.optional(v.string()),
	traceId: v.optional(v.string()),
	spanId: v.optional(v.string()),
	context: v.optional(v.nullable(v.unknown())),
});

export const SectionsListInput = v.object({
	project: v.optional(v.string()),
	...SyncInput.entries,
});

export const FormattedTaskSchema = v.object({
	id: v.string(),
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

export function requireDb(db: Database | null): asserts db is Database {
	if (!db) {
		throw new Error("no .doistrc found in this git repository");
	}
}
