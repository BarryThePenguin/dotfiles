export {
	addTask,
	completeTasks,
	moveTask,
	uncompleteTasks,
	updateTask,
	type OperationResult
} from "./operations.ts";
export * as Reconciliation from "./reconciliation.ts";
export {
	AddTaskFieldsSchema,
	ListTaskSchema,
	UpdateTaskFieldsSchema,
	type AddTaskFields,
	type UpdateTaskFields
} from "./schemas.ts";
export * as SyncState from "./sync-lifecycle.ts";

