// Container
export { createContainer, hasProjects, ProjectRefSchema } from "./container.ts";
export type {
	Container,
	OperationalContainer,
	ProjectRef,
} from "./container.ts";
export type { ConfigPaths } from "./paths.ts";

// Domain types
export type {
	AppTask,
	AppProject,
	AppSection,
	AppLabel,
	AppFilter,
	AppNote,
} from "./db-transform.ts";

// Operations
export {
	createTodoistOperations,
	addTask,
	completeTask,
	completeTasks,
	moveTask,
	uncompleteTasks,
	updateTask,
	resolveProject,
	listSections,
	listFilters,
	addFilter,
	updateFilter,
	deleteFilter,
	runFilterQuery,
	addTaskComment,
	listTaskComments,
} from "./operations.ts";
export type { OperationResult, TodoistOperations } from "./operations.ts";

export * as Reconciliation from "./reconciliation.ts";

// Validation schemas
export {
	AddTaskFieldsSchema,
	ListTaskSchema,
	UpdateTaskFieldsSchema,
	TasksUpdateInputSchema,
	AddFilterFieldsSchema,
	UpdateFilterFieldsSchema,
	FilterQueryInputSchema,
	AddCommentFieldsSchema,
	parseAddTaskFields,
	parseUpdateTaskFields,
	parseAddFilterFields,
	parseUpdateFilterFields,
	parseFilterQueryInput,
	parseAddCommentFields,
} from "./input-validation.ts";
export type {
	AddTaskFields,
	UpdateTaskFields,
	ListTaskOptions,
	TasksUpdateInput,
	AddFilterFields,
	UpdateFilterFields,
	FilterQueryInput,
	AddCommentFields,
} from "./input-validation.ts";

// Char limits
export { LIMITS } from "./limits.ts";

// Sync
export { countSyncData, syncAndPersist, syncAndFetch } from "./sync.ts";
export type { SyncResult, SyncAndPersistResult } from "./sync.ts";

export {
	getToken,
	setToken,
	resetToken,
	persistMutations,
	persistSync,
	computeSyncFingerprint,
	resolveSyncScope,
	getSyncFingerprint,
	setSyncFingerprint,
	resetSyncFingerprint,
	SYNC_SCOPE_VERSION,
} from "./sync-lifecycle.ts";
export type {
	MutationPersistOptions,
	SyncScopeResolution,
} from "./sync-lifecycle.ts";
export * as SyncState from "./sync-lifecycle.ts";

// Todoist client
export type { TodoistClient, AllData } from "./todoist.ts";

// Repo-aware project selection
export { applyRepoMarker, selectRepoProject } from "./repo-project.ts";

// Telemetry
export { recordException, tracer, trackOperation } from "./telemetry.ts";

// Logger
export { logger } from "./logger.ts";

// Session summary
export { TRIAGE_THRESHOLD } from "./session-summary.ts";
