// Domain types
export { Database } from "./db.ts";
export type { DbProject, DbTask, DbLabel, DbSection, DbFilter } from "./db.ts";
export { createContainer, ProjectRefSchema } from "./container.ts";
export type { Container, ProjectRef } from "./container.ts";
export type { ConfigPaths } from "./paths.ts";

// Schema transformations
export type {
	AppTask,
	AppProject,
	AppSection,
	AppLabel,
	AppFilter,
} from "./schema.ts";
export {
	normalizeTask,
	normalizeProject,
	normalizeSection,
	normalizeLabel,
	normalizeFilter,
} from "./schema.ts";

// Operations
export {
	addTask,
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
} from "./operations.ts";
export type { OperationResult } from "./operations.ts";

export * as Reconciliation from "./reconciliation.ts";

// Validation schemas
export {
	AddTaskFieldsSchema,
	ListTaskSchema,
	UpdateTaskFieldsSchema,
	TasksUpdateInputSchema,
	AddFilterFieldsSchema,
	UpdateFilterFieldsSchema,
	parseAddTaskFields,
	parseUpdateTaskFields,
} from "./schemas.ts";
export type {
	AddTaskFields,
	UpdateTaskFields,
	ListTaskOptions,
	TasksUpdateInput,
	AddFilterFields,
	UpdateFilterFields,
} from "./schemas.ts";

// SDK types
export { RestApiProjectSchema } from "./sdk.ts";
export type {
	RestApiProject,
	RestApiTaskByFilter,
	ResourceType,
	ResourceTypes,
	SyncCommand,
	SyncFilter,
	AddItemArgs,
	UpdateItemArgs,
} from "./sdk.ts";

// Sync
export { countSyncData, syncAndPersist, syncAndFetch } from "./sync.ts";
export type { SyncResult, SyncAndPersistResult } from "./sync.ts";

export {
	getToken,
	setToken,
	resetToken,
	persistMutations,
	persistSync,
} from "./sync-lifecycle.ts";
export type { MutationPersistOptions } from "./sync-lifecycle.ts";
export * as SyncState from "./sync-lifecycle.ts";

// Todoist client
export type { TodoistClient, AllData } from "./todoist.ts";

// Telemetry
export { recordException, tracer, trackOperation } from "./telemetry.ts";

// Logger
export { logger } from "./logger.ts";

// Semantic conventions
export {
	ATTR_EXITCODE,
	ATTR_COMMAND,
	ATTR_ARGUMENTS,
	ATTR_COMMANDLINE,
	ATTR_PROJECTID,
	ATTR_PROJECTNAME,
	ATTR_SYNCERRORMESSAGE,
	ATTR_SYNCITEMS,
	ATTR_SYNCLATENCY,
	ATTR_TASKID,
	ATTR_TASKPROJECTID,
	ATTR_OPERATION,
	SPAN_EVENT_SYNC_COMPLETED,
	SPAN_EVENT_SYNC_FAILED,
	SPAN_EVENT_TASK_CREATED,
	SPAN_NAME_SYNC,
	SPAN_NAME_DB_QUERY,
	SPAN_NAME_DB_TRANSACTION,
} from "./semconv.ts";

// Analysis
export {
	findDuplicateCandidates,
	findMissingEnergyMetadata,
	findStaleCandidates,
	filterByEnergy,
	groupStaleByProject,
} from "./analysis/index.ts";
