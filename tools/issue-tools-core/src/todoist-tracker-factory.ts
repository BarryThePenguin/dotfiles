import {
	createContainer,
	selectRepoProject,
	syncAndPersist,
	type Container,
	type DriverFactory,
} from "doist-core";
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
	driverFactory: DriverFactory,
): Promise<TodoistTrackerContext> {
	const container = createContainer(driverFactory);
	if (!container.paths) {
		throw new Error("Could not create Todoist tracker: no-config");
	}
	const projectIds = container.listProjectIds();
	if (projectIds.length === 0) {
		throw new Error("Could not create Todoist tracker: no-projects");
	}

	await syncAndPersist(container.db, container.client, projectIds, false);
	const projectId = repoProjectId(container);
	return {
		persistence: new TodoistAdapter(
			container.db,
			container.client,
			projectId ? { projectId } : {},
		),
	};
}

/**
 * Build the complete module set backed by one synchronized Todoist context.
 *
 * @param driverFactory Opens the SQLite database against the host runtime's
 *   native module — the host supplies it (`new Database(path)` from
 *   `bun:sqlite` under bun, `new DatabaseSync(path)` from `node:sqlite` under
 *   node)
 */
export async function createTodoistTrackerModules(
	driverFactory: DriverFactory,
): Promise<TrackerModules> {
	const context = await createTodoistTrackerContext(driverFactory);
	return createTrackerModulesFromBackend(context.persistence);
}

/** Select the configured repository project for callers that need to inspect it. */
export function selectTodoistRepoProjectId(
	container: Container,
): string | undefined {
	return repoProjectId(container);
}
