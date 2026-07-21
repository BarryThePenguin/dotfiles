import { afterEach, describe, it, expect } from "vitest";
import * as undici from "undici";
import {
	createFilterAddCommand,
	createFilterDeleteCommand,
	createFilterUpdateCommand,
	createItemAddCommand,
	createItemCompleteCommand,
	createItemUpdateCommand,
	SyncCommandError,
	syncRequest,
} from "./sdk.ts";
import {
	createMockApiFilter,
	createMockSyncResponse,
	interceptSync,
	TODOIST_ORIGIN,
} from "./test-helpers/api-mocks.ts";

// ── MockAgent setup ───────────────────────────────────────────────────────────

const mockAgent = new undici.MockAgent();
mockAgent.disableNetConnect();
undici.setGlobalDispatcher(mockAgent);

afterEach(() => {
	mockAgent.assertNoPendingInterceptors();
});

// ── Command Constructors (Type-Safe) ──────────────────────────────────────

describe("createItemCompleteCommand", () => {
	it("returns a complete command with the given args", () => {
		const cmd = createItemCompleteCommand({ id: "t1" });
		expect(cmd.type).toBe("item_complete");
		expect(cmd.args).toEqual({ id: "t1" });
		expect(cmd.suggestedResourceTypes).toEqual(["items"]);
	});

	it("generates a unique uuid per call", () => {
		const a = createItemCompleteCommand({ id: "t1" });
		const b = createItemCompleteCommand({ id: "t1" });
		expect(a.uuid).not.toBe(b.uuid);
		expect(a.uuid).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});
});

describe("createItemUpdateCommand", () => {
	it("returns an update command with the given args", () => {
		const cmd = createItemUpdateCommand({ id: "t1", content: "New title" });
		expect(cmd.type).toBe("item_update");
		expect(cmd.args).toEqual({ id: "t1", content: "New title" });
		expect(cmd.suggestedResourceTypes).toEqual(["items"]);
	});
});

describe("createItemAddCommand", () => {
	it("returns an add command with the given args", () => {
		const cmd = createItemAddCommand({ content: "Buy milk" });
		expect(cmd.type).toBe("item_add");
		expect(cmd.args).toEqual({ content: "Buy milk" });
		expect(cmd.suggestedResourceTypes).toEqual(["items"]);
	});

	it("sets temp_id when provided", () => {
		const cmd = createItemAddCommand({ content: "Buy milk" }, "tmp-123");
		expect(cmd.temp_id).toBe("tmp-123");
	});

	it("omits temp_id when not provided", () => {
		const cmd = createItemAddCommand({ content: "Buy milk" });
		expect(cmd.temp_id).toBeUndefined();
	});
});

// ── SyncCommandError ──────────────────────────────────────────────────────────

describe("SyncCommandError", () => {
	it("formats the message from failures", () => {
		const err = new SyncCommandError([
			{ uuid: "u1", error: "invalid id" },
			{ uuid: "u2", error: "not found" },
		]);
		expect(err.message).toContain("u1");
		expect(err.message).toContain("invalid id");
		expect(err.name).toBe("SyncCommandError");
	});

	it("exposes the failures array", () => {
		const failures = [{ uuid: "u1", error: "bad", errorCode: 400 }];
		const err = new SyncCommandError(failures);
		expect(err.failures).toEqual(failures);
	});
});

// ── syncRequest ───────────────────────────────────────────────────────────────

describe("syncRequest", () => {
	it("returns parsed sync response on success", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({ sync_token: "tok-abc", items: [] }),
		);
		const result = await syncRequest("mytoken", {
			sync_token: "*",
			resource_types: ["projects", "items"],
		});
		expect(result.sync_token).toBe("tok-abc");
		expect(result.items).toEqual([]);
	});

	it("throws on non-200 response", async () => {
		mockAgent
			.get(TODOIST_ORIGIN)
			.intercept({ path: "/api/v1/sync", method: "POST" })
			.reply(401, "Unauthorized");

		await expect(
			syncRequest("badtoken", {
				sync_token: "*",
				resource_types: ["projects", "items"],
			}),
		).rejects.toThrow("Todoist sync failed: 401");
	});

	it("throws SyncCommandError when sync_status contains a failure", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				sync_status: {
					"uuid-1": { error: "item not found", error_code: 404 },
				},
			}),
		);

		await expect(
			syncRequest("tok", {
				sync_token: "*",
				resource_types: ["items"],
				commands: [createItemCompleteCommand({ id: "t1" })],
			}),
		).rejects.toBeInstanceOf(SyncCommandError);
	});

	it("does not throw when all sync_status entries are ok", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				sync_status: { "uuid-1": "ok" },
			}),
		);

		await expect(
			syncRequest("tok", {
				sync_token: "tok",
				resource_types: ["items"],
				commands: [createItemCompleteCommand({ id: "t1" })],
			}),
		).resolves.toBeDefined();
	});
});

// ── Filter Command Constructors ────────────────────────────────────────────

describe("createFilterAddCommand", () => {
	it("returns an add command with the given args", () => {
		const cmd = createFilterAddCommand({
			name: "My Filter",
			query: "today & #Work",
		});
		expect(cmd.type).toBe("filter_add");
		expect(cmd.args).toEqual({ name: "My Filter", query: "today & #Work" });
		expect(cmd.suggestedResourceTypes).toEqual(["filters"]);
	});

	it("generates a unique uuid per call", () => {
		const a = createFilterAddCommand({ name: "A", query: "today" });
		const b = createFilterAddCommand({ name: "A", query: "today" });
		expect(a.uuid).not.toBe(b.uuid);
	});

	it("sets temp_id when provided", () => {
		const cmd = createFilterAddCommand(
			{ name: "A", query: "today" },
			"tmp-123",
		);
		expect(cmd.temp_id).toBe("tmp-123");
	});

	it("omits temp_id when not provided", () => {
		const cmd = createFilterAddCommand({ name: "A", query: "today" });
		expect(cmd.temp_id).toBeUndefined();
	});
});

describe("createFilterUpdateCommand", () => {
	it("returns an update command with the given args", () => {
		const cmd = createFilterUpdateCommand({
			id: "f1",
			name: "Renamed",
		});
		expect(cmd.type).toBe("filter_update");
		expect(cmd.args).toEqual({ id: "f1", name: "Renamed" });
		expect(cmd.suggestedResourceTypes).toEqual(["filters"]);
	});
});

describe("createFilterDeleteCommand", () => {
	it("returns a delete command with the given args", () => {
		const cmd = createFilterDeleteCommand({ id: "f1" });
		expect(cmd.type).toBe("filter_delete");
		expect(cmd.args).toEqual({ id: "f1" });
		expect(cmd.suggestedResourceTypes).toEqual(["filters"]);
	});
});

// ── Sync Response: Filters Parsing ─────────────────────────────────────────

describe("syncRequest with filters", () => {
	it("parses filters from sync response", async () => {
		interceptSync(
			mockAgent,
			createMockSyncResponse({
				sync_token: "tok",
				filters: [
					createMockApiFilter({
						id: "f1",
						name: "Today",
						query: "today",
					}),
					createMockApiFilter({
						id: "f2",
						name: "High Priority",
						query: "priority 1",
						color: "red",
						item_order: 2,
						is_favorite: true,
					}),
				],
			}),
		);

		const result = await syncRequest("mytoken", {
			sync_token: "*",
			resource_types: ["filters"],
		});

		expect(result.filters).toHaveLength(2);
		expect(result.filters?.[0]).toEqual({
			id: "f1",
			name: "Today",
			query: "today",
			color: "blue",
			item_order: 1,
			is_deleted: false,
			is_favorite: false,
			is_frozen: false,
		});
		expect(result.filters?.[1]).toEqual({
			id: "f2",
			name: "High Priority",
			query: "priority 1",
			color: "red",
			item_order: 2,
			is_deleted: false,
			is_favorite: true,
			is_frozen: false,
		});
	});

	it("returns empty filters array when no filters in response", async () => {
		interceptSync(mockAgent, createMockSyncResponse({ sync_token: "tok" }));

		const result = await syncRequest("mytoken", {
			sync_token: "*",
			resource_types: ["filters"],
		});

		expect(result.filters).toEqual([]);
	});
});
