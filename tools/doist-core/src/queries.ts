import type { Database, TaskCriteria } from "./db.ts";
import type {
	AppFilter,
	AppLabel,
	AppProject,
	AppTask,
} from "./db-transform.ts";

/**
 * The read intents actually needed outside doist-core.
 *
 * `browse` covers every combinable filter (CLI `task list`, the MCP
 * `list-tasks` tool) — those genuinely need to combine due/priority/label/
 * project/paging in one call. `search` is a fixed intent (content match,
 * incomplete only, priority-desc) rather than another combinable filter, so
 * it gets its own tag instead of more optional fields on `browse`.
 */
export type TaskQuery =
	| {
			kind: "browse";
			due?: "today" | "overdue";
			priority?: number;
			label?: string;
			projectId?: string;
			limit?: number;
			offset?: number;
			orderBy?: {
				field: "created_at" | "updated_at" | "due_date" | "priority";
				direction: "asc" | "desc";
			};
	  }
	| { kind: "search"; text: string };

/**
 * The read seam into doist-core's shared store.
 *
 * The only way outside doist-core to read tasks/projects/labels/sync
 * state — `operations.ts` is the matching seam for writes. Project-lens
 * scoping is bound in at construction (`createQueries`), so callers cannot
 * forget to apply it to `selectTasks`/`selectProjects`. `getTaskById` is
 * deliberately unscoped: it looks up an ID the caller already has (from a
 * prior list, a URL, or tool args), not a browse — rejecting a valid task
 * because it falls outside today's lens would be a surprising failure, not
 * a safety boundary.
 */
export interface Queries {
	getTaskById(id: string): AppTask | null;
	selectTasks(query: TaskQuery): AppTask[];
	selectProjects(): AppProject[];
	selectAllLabels(): AppLabel[];
	getLastSyncedAt(): string | null;
	getFilterByName(name: string): AppFilter | null;
}

function toTaskCriteria(
	query: TaskQuery,
	projectScope: string[],
): TaskCriteria {
	if (query.kind === "search") {
		return {
			content: query.text,
			completed: "incomplete",
			orderBy: { field: "priority", direction: "desc" },
			projectScope,
		};
	}

	return {
		...(query.due !== undefined ? { due: query.due } : {}),
		...(query.priority !== undefined ? { priority: query.priority } : {}),
		...(query.label !== undefined ? { label: query.label } : {}),
		...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
		...(query.limit !== undefined ? { limit: query.limit } : {}),
		...(query.offset !== undefined ? { offset: query.offset } : {}),
		...(query.orderBy !== undefined ? { orderBy: query.orderBy } : {}),
		projectScope,
	};
}

/**
 * Build the `Queries` seam over a `Database`, bound to the given project-lens.
 *
 * `listProjectIds` is a thunk rather than a snapshot so a lens that changes
 * mid-session (e.g. `projects add` in a freshly-initialized repo) is picked
 * up on the next call, matching how `Container` already resolves its own
 * lazy state.
 */
export function createQueries(
	db: Database,
	listProjectIds: () => string[],
): Queries {
	return {
		getTaskById: (id) => db.getTaskById(id),
		selectTasks: (query) =>
			db.selectTasks(toTaskCriteria(query, listProjectIds())),
		selectProjects: () => db.selectProjects(undefined, listProjectIds()),
		selectAllLabels: () => db.selectAllLabels(),
		getLastSyncedAt: () => db.getLastSyncedAt(),
		getFilterByName: (name) => db.getFilterByName(name),
	};
}
