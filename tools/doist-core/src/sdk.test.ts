import { afterEach, describe, it, expect } from "vitest";
import * as undici from "undici";
import {
	createItemAddCommand,
	createItemCompleteCommand,
	createItemUpdateCommand,
	SyncCommandError,
	syncRequest,
} from "./sdk.ts";
import {
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
