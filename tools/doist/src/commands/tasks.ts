import { sql, type SqlBool } from "kysely";
import * as v from "valibot";
import type { DbTask, SyncDb } from "../db.ts";

export const ListTaskSchema = v.object({
	project: v.optional(v.string()),
	due: v.optional(v.picklist(["today", "overdue"] as const)),
	priority: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4))),
	label: v.optional(v.string()),
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
});

export type ListTaskOptions = v.InferOutput<typeof ListTaskSchema>;

export function listTasks(db: SyncDb, opts: ListTaskOptions): DbTask[] {
	let query = db.q
		.selectFrom("tasks")
		.selectAll()
		.where("is_completed", "=", 0);

	if (opts.project) {
		query = query.where("project_id", "=", opts.project);
	}

	if (opts.due === "today" || opts.due === "overdue") {
		const today = new Date().toISOString().slice(0, 10);
		if (opts.due === "today") {
			query = query.where("due_date", "=", today);
		} else {
			query = query
				.where("due_date", "is not", null)
				.where("due_date", "<", today);
		}
	}

	if (opts.priority !== undefined) {
		query = query.where("priority", "=", opts.priority);
	}

	if (opts.label) {
		query = query.where(
			sql<SqlBool>`EXISTS (SELECT 1 FROM json_each(labels) WHERE value = ${opts.label})`,
		);
	}

	query = query.orderBy("priority", "desc");

	if (opts.limit !== undefined || opts.offset !== undefined) {
		// SQLite requires LIMIT when OFFSET is present; -1 means "no row limit"
		query = query.limit(opts.limit ?? -1);
		if (opts.offset !== undefined) {
			query = query.offset(opts.offset);
		}
	}

	return db.all(query.compile());
}

export function searchTasks(db: SyncDb, query: string): DbTask[] {
	return db.all(
		db.q
			.selectFrom("tasks")
			.selectAll()
			.where("is_completed", "=", 0)
			.where("content", "like", `%${query}%`)
			.orderBy("priority", "desc")
			.compile(),
	);
}

export function getTask(db: SyncDb, id: string): DbTask | null {
	return (
		db.get(
			db.q.selectFrom("tasks").selectAll().where("id", "=", id).compile(),
		) ?? null
	);
}

export type FormattedTask = Omit<DbTask, "labels"> & { labels: string[] };

const parseLabels = (stored: string | null): string[] =>
	stored ? (JSON.parse(stored) as string[]) : [];

export function formatTask(task: DbTask): FormattedTask {
	return { ...task, labels: parseLabels(task.labels) };
}

export function mergeLabelAdd(stored: string | null, label: string): string[] {
	const current = parseLabels(stored);
	return current.includes(label) ? current : [...current, label];
}

export function mergeLabelRemove(
	stored: string | null,
	label: string,
): string[] {
	return parseLabels(stored).filter((l) => l !== label);
}
