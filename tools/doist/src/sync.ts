import type { SyncDb } from "./db.ts";
import {
	getSyncToken,
	resetSyncToken,
	setLastSyncedAt,
	setSyncToken,
	upsertLabel,
	upsertProject,
	upsertSection,
	upsertTask,
} from "./db.ts";
import type { AllData, TodoistClient } from "./todoist.ts";

export type SyncResult = {
	projects: number;
	sections: number;
	labels: number;
	tasks: number;
	reconciled: number;
	updatedTaskIds: Set<string>;
};

export function filterToAllowedProjects(
	data: AllData,
	allowed: string[],
): AllData {
	if (allowed.length === 0) {
		return data;
	}

	const resolvedIds = new Set(allowed);
	for (const p of data.projects) {
		if (allowed.includes(p.name)) {
			resolvedIds.add(p.id);
		}
	}

	const allowedProjects = data.projects.filter((p) => resolvedIds.has(p.id));

	return {
		projects: allowedProjects,
		sections: data.sections.filter((s) => resolvedIds.has(s.project_id)),
		labels: data.labels,
		tasks: data.tasks.filter(
			(t) => t.project_id !== null && resolvedIds.has(t.project_id),
		),
		deletedTaskIds: data.deletedTaskIds,
		syncToken: data.syncToken,
	};
}

function reconcileCompleted(
	db: SyncDb,
	projectIds: string[],
	returnedTaskIds: Set<string>,
): number {
	if (projectIds.length === 0) {
		return 0;
	}

	const stale = db.all(
		db.q
			.selectFrom("tasks")
			.select("id")
			.where("is_completed", "=", 0)
			.where("project_id", "in", projectIds)
			.compile(),
	);

	const missing = stale.filter((r) => !returnedTaskIds.has(r.id));
	if (missing.length === 0) {
		return 0;
	}

	const now = new Date().toISOString();
	for (const { id } of missing) {
		db.run(
			db.q
				.updateTable("tasks")
				.set({ is_completed: 1, synced_at: now })
				.where("id", "=", id)
				.compile(),
		);
	}
	return missing.length;
}

function markDeleted(db: SyncDb, ids: string[]): void {
	if (ids.length === 0) {
		return;
	}
	const now = new Date().toISOString();
	for (const id of ids) {
		db.run(
			db.q
				.updateTable("tasks")
				.set({ is_completed: 1, synced_at: now })
				.where("id", "=", id)
				.compile(),
		);
	}
}

export async function sync(
	db: SyncDb,
	client: TodoistClient,
	allowedProjects: string[] = [],
	full = false,
): Promise<SyncResult> {
	if (full) {
		resetSyncToken(db);
	}
	const token = getSyncToken(db) ?? "*";
	const isFullSync = token === "*";
	const raw = await client.sync(token);
	const { projects, sections, labels, tasks, deletedTaskIds } =
		filterToAllowedProjects(raw, allowedProjects);

	const updatedTaskIds = isFullSync
		? new Set<string>()
		: new Set(tasks.map((t) => t.id));

	const reconciled = db.transaction(() => {
		for (const p of projects) {
			upsertProject(db, p);
		}
		for (const s of sections) {
			upsertSection(db, s);
		}
		for (const l of labels) {
			upsertLabel(db, l);
		}
		for (const t of tasks) {
			upsertTask(db, t);
		}
		markDeleted(db, deletedTaskIds);
		if (raw.syncToken) {
			setSyncToken(db, raw.syncToken);
		}
		setLastSyncedAt(db, new Date().toISOString());
		return isFullSync
			? reconcileCompleted(
					db,
					projects.map((p) => p.id),
					new Set(tasks.map((t) => t.id)),
				)
			: 0;
	});

	return {
		projects: projects.length,
		sections: sections.length,
		labels: labels.length,
		tasks: tasks.length,
		reconciled,
		updatedTaskIds,
	};
}
