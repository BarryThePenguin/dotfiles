import type { ProjectRef } from "doist-core";

export type SetupResult =
	| { ok: true; projectId: string }
	| { ok: false; reason: "no-projects" | "cancelled" | "not-found" };

export interface TodoistSetupContainer {
	listProjects(): ProjectRef[];
	setRepoProject(id: string): void;
}

interface ProjectSelector {
	selectProject: (
		projects: ProjectRef[],
	) => string | undefined | PromiseLike<string | undefined>;
}

/**
 * Shared Todoist project-selection orchestration used by both the Pi and
 * OpenCode adapters. Callers supply a `selectProject` callback that returns
 * the chosen project id (or undefined to cancel); the function validates it,
 * calls `setRepoProject`, and returns a typed result.
 */
export async function setupTodoistTracker(
	container: TodoistSetupContainer,
	options: ProjectSelector,
): Promise<SetupResult> {
	const projects = container.listProjects();
	if (projects.length === 0) {
		return { ok: false, reason: "no-projects" };
	}
	const projectId = await options.selectProject(projects);
	if (projectId === undefined) {
		return { ok: false, reason: "cancelled" };
	}
	if (!projects.find((p) => p.id === projectId)) {
		return { ok: false, reason: "not-found" };
	}
	container.setRepoProject(projectId);
	return { ok: true, projectId };
}
