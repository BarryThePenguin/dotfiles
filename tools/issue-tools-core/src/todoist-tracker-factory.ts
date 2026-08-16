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

async function createTodoistTrackerContext(
	rcDir?: string,
): Promise<TodoistTrackerContext> {
	const container = createContainer(rcDir);
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
 * @param rcDir Optional directory to start the `.doistrc` search from;
 *   defaults to `TODOIST_RC_DIR` or the process cwd.
 */
export async function createTodoistTrackerModules(
	rcDir?: string,
): Promise<TrackerModules> {
	const context = await createTodoistTrackerContext(rcDir);
	return createTrackerModulesFromBackend(context.persistence);
}

/** Select the configured repository project for callers that need to inspect it. */
export function selectTodoistRepoProjectId(
	container: Container,
): string | undefined {
	return repoProjectId(container);
}
