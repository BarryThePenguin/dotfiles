import * as undici from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./db.ts";
import {
	addTask,
	addTaskComment,
	completeTask,
	completeTasks,
	deleteFilter,
	listTaskComments,
	moveTask,
	resolveProject,
	uncompleteTasks,
	updateTask,
} from "./operations.ts";
import { SyncCommandError } from "./sdk.ts";
import { getToken, setToken } from "./sync-lifecycle.ts";
import {
	createMockApiNote,
	createMockApiTask,
	createMockSyncResponse,
	interceptSync,
	interceptSyncDynamic,
} from "./test-helpers/api-mocks.ts";
import {
	createTestContainer,
	type TestContainer,
} from "./test-helpers/container.ts";
import { openDb } from "./test-helpers/database.ts";
import {
	NOW,
	NOTE_ALPHA,
	NOTE_IDS,
	PROJECT_IDS,
	PROJECT_INBOX,
	PROJECT_PERSONAL,
	PROJECT_WORK,
	TASK_ALPHA,
	TASK_BETA,
	TASK_DONE,
	TASK_IDS,
} from "./test-helpers/fixtures.ts";
import { createClient } from "./todoist.ts";

// ── Mock Agent Setup ──────────────────────────────────────────────────────

describe("mock HTTP client", () => {
	let mockAgent: undici.MockAgent;

	beforeEach(() => {
		mockAgent = new undici.MockAgent();
		mockAgent.disableNetConnect();
		undici.setGlobalDispatcher(mockAgent);
	});

	afterEach(() => {
		mockAgent.assertNoPendingInterceptors();
		undici.setGlobalDispatcher(new undici.Agent());
	});

	// ── updateTask tests ──────────────────────────────────────────────────────

	describe("updateTask", () => {
		let container: TestContainer;

		beforeEach(() => {
			container = createTestContainer({
				projects: [PROJECT_IDS.inbox, PROJECT_IDS.personal],
			});

			// Pre-populate: project and task in DB
			container.db.upsertProject(PROJECT_INBOX);
			container.db.upsertProject(PROJECT_PERSONAL);
			container.db.upsertTask(TASK_ALPHA);

			// Set initial sync token so sync doesn't do a full sync
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("updates task", async () => {
			// updateTask command succeeds
			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							content: "Updated via API",
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await updateTask(container.db, client, TASK_IDS.alpha, {
				title: "Updated via API",
			});

			// Verify result
			expect(result.ok).toBe(true);
			expect(result.result.content).toBe("Updated via API");

			// Verify persistence
			const persisted = container.db.getTaskById(TASK_IDS.alpha);
			expect(persisted?.content).toBe("Updated via API");

			// Verify sync token advanced
			expect(getToken(container.db)).toBe("tok-1");
		});

		it("merges label additions correctly", async () => {
			// Pre-populate task with existing labels
			container.db.upsertTask({
				...TASK_ALPHA,
				labels: JSON.stringify(["urgent"]),
			});

			// updateTask succeeds with merged labels
			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							labels: ["urgent", "high"],
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await updateTask(container.db, client, TASK_IDS.alpha, {
				addLabels: ["high"],
			});

			// Verify result
			expect(result.ok).toBe(true);
			expect(result.result.labels).toEqual(["urgent", "high"]);

			// Verify persisted with merged labels
			const persisted = container.db.getTaskById(TASK_IDS.alpha);
			expect(persisted?.labels).toEqual(["urgent", "high"]);
		});

		it("is idempotent when addLabels overlaps with existing labels", async () => {
			// Pre-populate task with existing labels
			container.db.upsertTask({
				...TASK_ALPHA,
				labels: JSON.stringify(["urgent", "home"]),
			});

			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							labels: ["urgent", "home", "new"],
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await updateTask(container.db, client, TASK_IDS.alpha, {
				addLabels: ["home", "new"],
			});

			// Order preserved: existing first (with duplicates dropped), then new appends
			expect(result.ok).toBe(true);
			expect(result.result.labels).toEqual(["urgent", "home", "new"]);
			const persisted = container.db.getTaskById(TASK_IDS.alpha);
			expect(persisted?.labels).toEqual(["urgent", "home", "new"]);
		});

		it("preserves order of multiple new labels in addLabels", async () => {
			container.db.upsertTask({
				...TASK_ALPHA,
				labels: JSON.stringify(["urgent"]),
			});

			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							labels: ["urgent", "zeta", "alpha", "mike"],
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await updateTask(container.db, client, TASK_IDS.alpha, {
				addLabels: ["zeta", "alpha", "mike"],
			});

			expect(result.result.labels).toEqual(["urgent", "zeta", "alpha", "mike"]);
		});

		it("removes labels from existing set", async () => {
			container.db.upsertTask({
				...TASK_ALPHA,
				labels: JSON.stringify(["urgent", "home", "work"]),
			});

			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							labels: ["urgent", "work"],
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await updateTask(container.db, client, TASK_IDS.alpha, {
				removeLabels: ["home"],
			});

			expect(result.ok).toBe(true);
			expect(result.result.labels).toEqual(["urgent", "work"]);
		});

		it("remove wins when the same label is in both addLabels and removeLabels", async () => {
			container.db.upsertTask({
				...TASK_ALPHA,
				labels: JSON.stringify(["urgent", "home"]),
			});

			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							labels: ["urgent", "new"],
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await updateTask(container.db, client, TASK_IDS.alpha, {
				addLabels: ["new", "home"],
				removeLabels: ["home"],
			});

			// "home" is in both addLabels and removeLabels → remove wins; result does not include "home"
			expect(result.ok).toBe(true);
			expect(result.result.labels).toEqual(["urgent", "new"]);
		});

		it("adds fresh labels when no existing labels are stored", async () => {
			container.db.upsertTask({
				...TASK_ALPHA,
				labels: JSON.stringify([]),
			});

			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							labels: ["fresh", "label"],
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await updateTask(container.db, client, TASK_IDS.alpha, {
				addLabels: ["fresh", "label"],
			});

			expect(result.result.labels).toEqual(["fresh", "label"]);
		});

		it("moves task to another project", async () => {
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					type?: string;
					args?: { project_id?: string };
				}>;

				expect(commands[0]?.type).toBe("item_move");
				expect(commands[0]?.args?.project_id).toBe(PROJECT_IDS.personal);

				return {
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							content: "Updated via API",
							project_id: PROJECT_IDS.personal,
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await moveTask(
				container.db,
				client,
				TASK_IDS.alpha,
				"Personal",
			);

			expect(result.ok).toBe(true);
			expect(result.result.projectId).toBe(PROJECT_IDS.personal);
		});
	});

	// ── addTask tests ──────────────────────────────────────────────────────

	describe("addTask", () => {
		let container: TestContainer;

		beforeEach(() => {
			container = createTestContainer({
				projects: [PROJECT_IDS.inbox],
			});

			// Pre-populate: project in DB
			container.db.upsertProject(PROJECT_INBOX);

			// Set initial sync token
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("happy path: creates task and syncs result", async () => {
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					temp_id?: string;
				}>;
				const tempId = commands[0]?.temp_id ?? "temp-1";

				return {
					sync_token: "tok-1",
					temp_id_mapping: { [tempId]: "t-new-real" },
					items: [
						createMockApiTask({
							id: "t-new-real",
							content: "Buy groceries",
							priority: 2,
							project_id: PROJECT_IDS.inbox,
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await addTask(container.db, client, {
				title: "Buy groceries",
				priority: 2,
			});

			expect(result.ok).toBe(true);
			expect(result.result.id).toBe("t-new-real");
			expect(result.result.content).toBe("Buy groceries");
			expect(result.result.priority).toBe(2);

			const persisted = container.db.getTaskById("t-new-real");
			expect(persisted?.content).toBe("Buy groceries");

			expect(getToken(container.db)).toBe("tok-1");
		});

		it("resolves project name to id before creating task", async () => {
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					temp_id?: string;
				}>;
				const tempId = commands[0]?.temp_id ?? "temp-2";

				return {
					sync_token: "tok-1",
					temp_id_mapping: { [tempId]: "t-new" },
					items: [
						createMockApiTask({
							id: "t-new",
							project_id: PROJECT_IDS.inbox,
							content: "Task in Inbox",
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await addTask(container.db, client, {
				title: "Task in Inbox",
				project: "Inbox",
			});

			expect(result.ok).toBe(true);
			expect(result.result.id).toBe("t-new");
			expect(result.result.projectId).toBe(PROJECT_IDS.inbox);
		});

		it("includes optional fields when provided", async () => {
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					temp_id?: string;
				}>;
				const tempId = commands[0]?.temp_id ?? "temp-3";

				return {
					sync_token: "tok-1",
					temp_id_mapping: { [tempId]: "t-new" },
					items: [
						createMockApiTask({
							id: "t-new",
							content: "Complete task",
							priority: 3,
							due: { date: "2026-05-25", string: "May 25" },
							labels: ["urgent"],
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await addTask(container.db, client, {
				title: "Complete task",
				priority: 3,
				due: "2026-05-25",
				labels: ["urgent"],
			});

			expect(result.ok).toBe(true);
			expect(result.result.content).toBe("Complete task");
			expect(result.result.priority).toBe(3);
			expect(result.result.due?.date).toBe("2026-05-25");
			expect(result.result.labels).toEqual(["urgent"]);
		});

		it("passes parentId through when creating a subtask", async () => {
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					temp_id?: string;
					args?: { parent_id?: string };
				}>;
				const command = commands[0];
				const tempId = command?.temp_id ?? "temp-subtask";

				expect(command?.args?.parent_id).toBe("parent-task-id");

				return {
					sync_token: "tok-1",
					temp_id_mapping: { [tempId]: "t-subtask" },
					items: [
						createMockApiTask({
							id: "t-subtask",
							content: "Nested task",
							parent_id: "parent-task-id",
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await addTask(container.db, client, {
				title: "Nested task",
				parentId: "parent-task-id",
			});

			expect(result.ok).toBe(true);
			expect(result.result.parentId).toBe("parent-task-id");
		});
	});

	// ── completeTasks tests ──────────────────────────────────────────────────

	describe("completeTasks", () => {
		let container: TestContainer;

		beforeEach(() => {
			container = createTestContainer({
				projects: [PROJECT_IDS.inbox],
			});

			// Pre-populate: project and task
			container.db.upsertProject(PROJECT_INBOX);
			container.db.upsertTask(TASK_ALPHA);

			// Set initial sync token
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("completes multiple tasks in batch", async () => {
			// Add second task to container
			container.db.upsertTask(TASK_BETA);

			// Set up mock response for sync with two completed tasks
			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({ id: TASK_IDS.alpha, checked: true }),
						createMockApiTask({ id: TASK_IDS.beta, checked: true }),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await completeTasks(container.db, client, [
				TASK_IDS.alpha,
				TASK_IDS.beta,
			]);

			// Verify result
			expect(result.ok).toBe(true);
			expect(result.result).toBe(2);

			// Verify persistence
			const alpha = container.db.getTaskById(TASK_IDS.alpha);
			expect(alpha?.isCompleted).toBe(true);
			const beta = container.db.getTaskById(TASK_IDS.beta);
			expect(beta?.isCompleted).toBe(true);

			// Verify sync token advanced
			expect(getToken(container.db)).toBe("tok-1");
		});

		it("counts subtasks Todoist completes when a parent is completed", async () => {
			container.db.upsertTask({
				...TASK_BETA,
				id: "child-task",
				parent_id: TASK_IDS.alpha,
			});

			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					items: [
						createMockApiTask({
							id: TASK_IDS.alpha,
							checked: true,
						}),
						createMockApiTask({
							id: "child-task",
							checked: true,
							parent_id: TASK_IDS.alpha,
						}),
					],
				}),
			);

			const client = createClient("test-token");
			const result = await completeTasks(container.db, client, [
				TASK_IDS.alpha,
			]);

			expect(result.ok).toBe(true);
			expect(result.result).toBe(2);
			expect(container.db.getTaskById(TASK_IDS.alpha)?.isCompleted).toBe(true);
			expect(container.db.getTaskById("child-task")?.isCompleted).toBe(true);
		});

		it("handles empty array case", async () => {
			const client = createClient("test-token");
			const result = await completeTasks(container.db, client, []);

			expect(result.ok).toBe(true);
			expect(result.result).toBe(0);
		});
	});

	describe("uncompleteTasks", () => {
		let container: TestContainer;

		beforeEach(() => {
			container = createTestContainer({
				projects: [PROJECT_IDS.inbox],
			});

			container.db.upsertProject(PROJECT_INBOX);
			container.db.upsertTask(TASK_DONE);
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("reopens completed tasks in batch", async () => {
			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-2",
					items: [createMockApiTask({ id: TASK_IDS.done, checked: false })],
				}),
			);

			const client = createClient("test-token");
			const result = await uncompleteTasks(container.db, client, [
				TASK_IDS.done,
			]);

			expect(result.ok).toBe(true);
			expect(result.result).toBe(1);
			expect(container.db.getTaskById(TASK_IDS.done)?.isCompleted).toBe(false);
			expect(getToken(container.db)).toBe("tok-2");
		});

		it("handles empty array case", async () => {
			const client = createClient("test-token");
			const result = await uncompleteTasks(container.db, client, []);

			expect(result.ok).toBe(true);
			expect(result.result).toBe(0);
		});
	});

	// ── completeTask tests (single, with optional closing comment) ─────

	describe("completeTask", () => {
		let container: TestContainer;

		beforeEach(() => {
			container = createTestContainer({
				projects: [PROJECT_IDS.inbox],
			});
			container.db.upsertProject(PROJECT_INBOX);
			container.db.upsertTask(TASK_ALPHA);
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("completes a single task in one sync round trip (no comment)", async () => {
			let captured: Array<{ type: string; args: Record<string, unknown> }> = [];
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				captured = JSON.parse(params.get("commands") ?? "[]") as Array<{
					type: string;
					args: Record<string, unknown>;
				}>;
				return {
					sync_token: "tok-1",
					items: [createMockApiTask({ id: TASK_IDS.alpha, checked: true })],
				};
			});

			const client = createClient("test-token");
			const result = await completeTask(container.db, client, TASK_IDS.alpha);

			expect(result.ok).toBe(true);
			expect(result.result).toBe(TASK_IDS.alpha);
			// One sync call carries the single close command
			expect(captured).toHaveLength(1);
			expect(captured[0]).toMatchObject({
				type: "item_close",
				args: { id: TASK_IDS.alpha },
			});
			expect(container.db.getTaskById(TASK_IDS.alpha)?.isCompleted).toBe(true);
			expect(getToken(container.db)).toBe("tok-1");
		});

		it("closes and comments atomically in one sync when a comment is provided", async () => {
			let captured: Array<{
				type: string;
				args: Record<string, unknown>;
				temp_id?: string;
			}> = [];
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				captured = JSON.parse(params.get("commands") ?? "[]") as Array<{
					type: string;
					args: Record<string, unknown>;
					temp_id?: string;
				}>;
				const noteTempId =
					captured.find((c) => c.type === "note_add")?.temp_id ?? "t-note";
				return {
					sync_token: "tok-1",
					temp_id_mapping: { [noteTempId]: "n-closing" },
					items: [createMockApiTask({ id: TASK_IDS.alpha, checked: true })],
					notes: [
						createMockApiNote({
							id: "n-closing",
							item_id: TASK_IDS.alpha,
							content: "Closing: wontfix",
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await completeTask(
				container.db,
				client,
				TASK_IDS.alpha,
				"Closing: wontfix",
			);

			expect(result.ok).toBe(true);
			// The single sync call carried both the close and the note add
			expect(captured.map((c) => c.type).toSorted()).toEqual([
				"item_close",
				"note_add",
			]);
			const closeCmd = captured.find((c) => c.type === "item_close");
			const noteCmd = captured.find((c) => c.type === "note_add");
			expect(closeCmd?.args).toEqual({ id: TASK_IDS.alpha });
			expect(noteCmd?.args).toEqual({
				item_id: TASK_IDS.alpha,
				content: "Closing: wontfix",
			});

			// Task is closed and the comment is persisted in the same transaction
			expect(container.db.getTaskById(TASK_IDS.alpha)?.isCompleted).toBe(true);
			const notes = container.db.selectNotesByTask(TASK_IDS.alpha);
			expect(notes).toHaveLength(1);
			expect(notes[0]).toMatchObject({
				itemId: TASK_IDS.alpha,
				content: "Closing: wontfix",
			});
		});
	});

	describe("addTaskComment", () => {
		let container: TestContainer;

		beforeEach(() => {
			container = createTestContainer({
				projects: [PROJECT_IDS.inbox],
			});
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("happy path: sends note_add with item_id (regression for task_id bug)", async () => {
			let captured:
				| { type: string; args: Record<string, unknown>; temp_id?: string }
				| undefined;
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					type: string;
					args: Record<string, unknown>;
					temp_id?: string;
				}>;
				captured = commands[0];
				const tempId = commands[0]?.temp_id ?? "t-1";
				return {
					sync_token: "tok-1",
					temp_id_mapping: { [tempId]: "n-new" },
					notes: [
						createMockApiNote({
							id: "n-new",
							item_id: "t1",
							content: "Resolution: done",
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await addTaskComment(
				container.db,
				client,
				"t1",
				"Resolution: done",
			);

			expect(result.ok).toBe(true);
			// Regression: must be item_id, not task_id — the latter is what
			// caused "Invalid argument value" from the Todoist API.
			expect(captured?.type).toBe("note_add");
			expect(captured?.args).toEqual({
				item_id: "t1",
				content: "Resolution: done",
			});
			expect(captured?.args).not.toHaveProperty("task_id");
			expect(result.result).toMatchObject({
				id: "n-new",
				itemId: "t1",
				content: "Resolution: done",
			});
		});

		it("write-through: persists the new note to the db", async () => {
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					temp_id?: string;
				}>;
				const tempId = commands[0]?.temp_id ?? "t-1";
				return {
					sync_token: "tok-1",
					temp_id_mapping: { [tempId]: "n-new" },
					notes: [
						createMockApiNote({
							id: "n-new",
							item_id: "t1",
							content: "Resolution: done",
						}),
					],
				};
			});

			const client = createClient("test-token");
			const result = await addTaskComment(
				container.db,
				client,
				"t1",
				"Resolution: done",
			);

			expect(result.ok).toBe(true);
			// Write-through: subsequent listTaskComments reads from db and
			// finds the note without another sync.
			const listed = listTaskComments(container.db, "t1");
			expect(listed.ok).toBe(true);
			expect(listed.result).toHaveLength(1);
			expect(listed.result[0]).toMatchObject({
				id: "n-new",
				itemId: "t1",
				content: "Resolution: done",
			});
		});

		it("advances sync token", async () => {
			interceptSyncDynamic(mockAgent, (reqBody) => {
				const params = new URLSearchParams(reqBody);
				const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
					temp_id?: string;
				}>;
				const tempId = commands[0]?.temp_id ?? "t-1";
				return {
					sync_token: "tok-1",
					temp_id_mapping: { [tempId]: "n-new" },
					notes: [createMockApiNote({ id: "n-new", item_id: "t1" })],
				};
			});

			const client = createClient("test-token");
			await addTaskComment(container.db, client, "t1", "hi");
			expect(getToken(container.db)).toBe("tok-1");
		});
	});

	// ── deleteFilter tests ────────────────────────────────────────────────

	describe("deleteFilter", () => {
		let container: TestContainer;

		beforeEach(() => {
			container = createTestContainer({
				projects: [PROJECT_IDS.inbox],
			});
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("throws SyncCommandError and does NOT clear the local row when the server rejects the delete", async () => {
			// Pre-populate the local DB with a filter that doesn't exist on the server.
			container.db.upsertFilter({
				id: "f-ghost",
				name: "Stale",
				query: "today",
				color: null,
				item_order: 1,
				is_favorite: 0,
				synced_at: NOW,
			});

			// Server returns a sync_status error for the filter_delete command.
			interceptSync(
				mockAgent,
				createMockSyncResponse({
					sync_token: "tok-1",
					sync_status: {
						"cmd-uuid-1": { error: "Filter not found", error_code: 404 },
					},
				}),
			);

			const client = createClient("test-token");
			await expect(
				deleteFilter(container.db, client, "f-ghost"),
			).rejects.toBeInstanceOf(SyncCommandError);

			// The local row must still be there — persistMutations never ran.
			const stillThere = container.db.getFilterById("f-ghost");
			expect(stillThere).not.toBeNull();
			expect(stillThere?.name).toBe("Stale");
		});
	});
});

// ── resolveProject tests ──────────────────────────────────────────────────

describe("resolveProject", () => {
	let db: ReturnType<typeof openDb>;

	beforeEach(() => {
		db = openDb();
	});

	afterEach(() => {
		db.close();
	});

	it("resolves a known project name to its id", () => {
		db.upsertProject(PROJECT_WORK);
		db.upsertProject(PROJECT_PERSONAL);
		const id = resolveProject(db, "Work");
		expect(id).toBe(PROJECT_IDS.work);
	});

	it("returns undefined when no project name matches", () => {
		expect(resolveProject(db, "raw-id-xyz")).toBeUndefined();
	});

	it("returns the input as-is when the project id is allowed", () => {
		db.upsertProject(PROJECT_WORK);
		db.upsertProject(PROJECT_PERSONAL);
		const resolved = resolveProject(db, PROJECT_IDS.work);
		expect(resolved).toBe(PROJECT_IDS.work);
	});

	it("returns undefined when multiple projects share the name", () => {
		const PROJECT_WORK_DUP = {
			id: "p-work-dup",
			name: "Work",
			color: null,
			is_favorite: 0,
			is_inbox: 0,
			synced_at: NOW,
		};
		db.upsertProject(PROJECT_WORK);
		db.upsertProject(PROJECT_PERSONAL);
		db.upsertProject(PROJECT_WORK_DUP);
		expect(resolveProject(db, "Work")).toBeUndefined();
	});
});

describe("listTaskComments", () => {
	let db: Database;

	beforeEach(() => {
		db = openDb();
	});

	afterEach(() => {
		db.close();
	});

	it("returns notes for a task from the db", () => {
		db.upsertNote(NOTE_ALPHA);
		const result = listTaskComments(db, "t1");
		expect(result.ok).toBe(true);
		expect(result.result).toHaveLength(1);
		expect(result.result[0]).toMatchObject({
			id: NOTE_IDS.alpha,
			itemId: "t1",
			content: "Resolution: alpha",
		});
	});

	it("returns [] for a task with no notes", () => {
		const result = listTaskComments(db, "no-such-task");
		expect(result.ok).toBe(true);
		expect(result.result).toEqual([]);
	});
});
