import { createContainer, selectRepoProject, type Container } from "doist-core";
import { createTrackerModulesFromBackend } from "./modules.ts";
import type { TrackerModules } from "./modules.ts";
import { TodoistAdapter } from "./todoist-adapter.ts";

type TodoistTrackerContext = {
	readonly persistence: TodoistAdapter;
};

function repoProjectId(container: Container): string | undefined {
	if (!container.paths) {
		return undefined;
	}
	return selectRepoProject(container.listProjects())?.id;
}

async function createTodoistTrackerContext(): Promise<TodoistTrackerContext> {
	const container = createContainer();
	if (!container.paths) {
		throw new Error("Could not create Todoist tracker: no-config");
	}
	const projectIds = container.listProjectIds();
	if (projectIds.length === 0) {
		throw new Error("Could not create Todoist tracker: no-projects");
	}

	await container.sync(projectIds, false);
	const projectId = repoProjectId(container);
	return {
		persistence: new TodoistAdapter(container, projectId ? { projectId } : {}),
	};
}

/**
 * Build the complete module set backed by one synchronized Todoist context.
 *
 */
export async function createTodoistTrackerModules(): Promise<TrackerModules> {
	const context = await createTodoistTrackerContext();
	return createTrackerModulesFromBackend(context.persistence);
}

/** Select the configured repository project for callers that need to inspect it. */
export function selectTodoistRepoProjectId(
	container: Container,
): string | undefined {
	return repoProjectId(container);
}
