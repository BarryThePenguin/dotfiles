import * as undici from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addTask,
	completeTasks,
	resolveProject,
	updateTask,
} from "./operations.ts";
import { getToken, setToken } from "./sync-lifecycle.ts";
import { createTestContainer, type TestContainer } from "./test-helpers/container.ts";
import { openDb } from "./test-helpers/database.ts";
import {
	createMockApiTask,
	createMockSyncResponse,
	interceptSync,
	interceptSyncDynamic,
} from "./test-helpers/api-mocks.ts";
import {
	NOW,
	PROJECT_IDS,
	PROJECT_INBOX,
	PROJECT_WORK,
	PROJECT_PERSONAL,
	TASK_IDS,
	TASK_ALPHA,
	TASK_BETA,
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
				projects: [PROJECT_IDS.inbox],
			});

			// Pre-populate: project and task in DB
			container.db.upsertProject(PROJECT_INBOX);
			container.db.upsertTask(TASK_ALPHA);

			// Set initial sync token so sync doesn't do a full sync
			setToken(container.db, "tok-0");
		});

		afterEach(() => {
			container.db.close();
		});

		it("happy path: updates task when no conflict detected", async () => {
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
			expect(result.result?.content).toBe("Updated via API");

			// Verify persistence
			const persisted = container.db.selectTaskById(TASK_IDS.alpha);
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
			expect(result.result?.labels).toEqual(["urgent", "high"]);

			// Verify persisted with merged labels
			const persisted = container.db.selectTaskById(TASK_IDS.alpha);
			expect(persisted?.labels).toEqual(["urgent", "high"]);
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
			expect(result.result?.id).toBe("t-new-real");
			expect(result.result?.content).toBe("Buy groceries");
			expect(result.result?.priority).toBe(2);

			const persisted = container.db.selectTaskById("t-new-real");
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
			expect(result.result?.id).toBe("t-new");
			expect(result.result?.projectId).toBe(PROJECT_IDS.inbox);
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
			expect(result.result?.content).toBe("Complete task");
			expect(result.result?.priority).toBe(3);
			expect(result.result?.due?.date).toBe("2026-05-25");
			expect(result.result?.labels).toEqual(["urgent"]);
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
						createMockApiTask({
							id: TASK_IDS.alpha,
							completed_at: "2026-05-24T10:00:00Z",
						}),
						createMockApiTask({
							id: TASK_IDS.beta,
							completed_at: "2026-05-24T10:00:00Z",
						}),
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
			const alpha = container.db.selectTaskById(TASK_IDS.alpha);
			expect(alpha?.completed).toBe(true);
			const beta = container.db.selectTaskById(TASK_IDS.beta);
			expect(beta?.completed).toBe(true);

			// Verify sync token advanced
			expect(getToken(container.db)).toBe("tok-1");
		});

		it("handles empty array case", async () => {
			const client = createClient("test-token");
			const result = await completeTasks(container.db, client, []);

			expect(result.ok).toBe(true);
			expect(result.result).toBe(0);
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

	it("returns the input as-is when no project name matches", () => {
		const id = resolveProject(db, "raw-id-xyz");
		expect(id).toBe("raw-id-xyz");
	});

	it("returns the input as-is when multiple projects share the name", () => {
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
		const resolved = resolveProject(db, "Work");
		expect(resolved).toBe("Work");
	});
});
