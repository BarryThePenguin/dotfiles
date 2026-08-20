import type { ProjectRef } from "doist-core";

export interface TodoistSetupContainer {
	listProjects(): ProjectRef[];
	setRepoProject(id: string): void;
}

export type SetupOutcome =
	| { status: "success"; projectId: string }
	| { status: "no-projects" }
	| { status: "not-found"; available: string[] }
	| { status: "cancelled" };

export async function runTodoistSetup(opts: {
	container: TodoistSetupContainer;
	selectProject: (
		projects: ProjectRef[],
	) => string | undefined | PromiseLike<string | undefined>;
}): Promise<SetupOutcome> {
	const projects = opts.container.listProjects();
	if (projects.length === 0) {
		return { status: "no-projects" };
	}
	const projectId = await opts.selectProject(projects);
	if (projectId === undefined) {
		return { status: "cancelled" };
	}
	if (!projects.find((p) => p.id === projectId)) {
		return { status: "not-found", available: projects.map((p) => p.id) };
	}
	opts.container.setRepoProject(projectId);
	return { status: "success", projectId };
}
