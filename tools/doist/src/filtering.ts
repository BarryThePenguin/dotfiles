import type { AllData } from "./todoist.ts";
import { logger } from "./logger.ts";

/**
 * Filter sync response to allowed projects.
 *
 * Only keeps resources that belong to allowed project IDs or names.
 * Used before writing to the database to enforce project allowlist.
 */
export function filterToAllowedProjects(
	data: AllData,
	allowed: string[],
): AllData {
	if (allowed.length === 0) {
		logger.info(
			{ tasks_count: data.tasks.length },
			"filterToAllowedProjects: no filter applied (empty allowed list)",
		);
		return data;
	}

	const resolvedIds = new Set(allowed);
	for (const p of data.projects) {
		if (allowed.includes(p.name)) {
			resolvedIds.add(p.id);
		}
	}

	logger.info(
		{
			allowed_ids: Array.from(resolvedIds),
			all_project_ids_in_response: data.projects.map((p) => p.id),
			all_task_ids_in_response: data.tasks.map((t) => t.id),
		},
		"filterToAllowedProjects: resolved project IDs",
	);

	const allowedProjects = data.projects.filter((p) => resolvedIds.has(p.id));
	const filteredTasks = data.tasks.filter(
		(t) => t.project_id !== null && resolvedIds.has(t.project_id),
	);

	logger.info(
		{
			filtered_task_ids: filteredTasks.map((t) => t.id),
			tasks_before: data.tasks.length,
			tasks_after: filteredTasks.length,
			filtered_out_tasks: data.tasks
				.filter((t) => t.project_id === null || !resolvedIds.has(t.project_id))
				.map((t) => ({
					id: t.id,
					project_id: t.project_id,
					reason:
						t.project_id === null ? "null_project_id" : "not_in_allowed_list",
				})),
		},
		"filterToAllowedProjects: filtered tasks",
	);

	return {
		projects: allowedProjects,
		sections: data.sections.filter((s) => resolvedIds.has(s.project_id)),
		labels: data.labels,
		tasks: filteredTasks,
		completedTaskIds: data.completedTaskIds,
		deletedTaskIds: data.deletedTaskIds,
		syncToken: data.syncToken,
		...(data.tempIdMapping !== undefined && {
			tempIdMapping: data.tempIdMapping,
		}),
	};
}
