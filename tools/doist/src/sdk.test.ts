import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import type { Dispatcher, Interceptable } from "undici";
import { createCommand, SyncCommandError, syncRequest } from "./sdk.ts";

// ── MockAgent setup ───────────────────────────────────────────────────────────

let savedDispatcher: Dispatcher;
let agent: MockAgent;
let pool: Interceptable;

const TODOIST_ORIGIN = "https://api.todoist.com";

beforeEach(() => {
	savedDispatcher = getGlobalDispatcher();
	agent = new MockAgent();
	agent.disableNetConnect();
	setGlobalDispatcher(agent);
	pool = agent.get(TODOIST_ORIGIN);
});

afterEach(async () => {
	await agent.close();
	setGlobalDispatcher(savedDispatcher);
});

function replySync(body: unknown) {
	pool
		.intercept({ path: "/api/v1/sync", method: "POST" })
		.reply(200, JSON.stringify(body), {
			headers: { "content-type": "application/json" },
		});
}

// ── createCommand ─────────────────────────────────────────────────────────────

describe("createCommand", () => {
	it("returns a command with the given type and args", () => {
		const cmd = createCommand("item_complete", { id: "t1" });
		expect(cmd.type).toBe("item_complete");
		expect(cmd.args).toEqual({ id: "t1" });
	});

	it("generates a unique uuid per call", () => {
		const a = createCommand("item_complete", {});
		const b = createCommand("item_complete", {});
		expect(a.uuid).not.toBe(b.uuid);
		expect(a.uuid).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("sets temp_id when provided", () => {
		const cmd = createCommand("item_add", { content: "Buy milk" }, "tmp-123");
		expect(cmd.temp_id).toBe("tmp-123");
	});

	it("omits temp_id when not provided", () => {
		const cmd = createCommand("item_update", { id: "t1" });
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
		replySync({ sync_token: "tok-abc", items: [] });
		const result = await syncRequest("mytoken", {
			sync_token: "*",
			resource_types: "[]",
		});
		expect(result.syncToken).toBe("tok-abc");
		expect(result.items).toEqual([]);
	});

	it("throws on non-200 response", async () => {
		pool
			.intercept({ path: "/api/v1/sync", method: "POST" })
			.reply(401, "Unauthorized");

		await expect(
			syncRequest("badtoken", { sync_token: "*", resource_types: "[]" }),
		).rejects.toThrow("Todoist sync failed: 401");
	});

	it("throws SyncCommandError when sync_status contains a failure", async () => {
		replySync({
			sync_token: "tok",
			sync_status: {
				"uuid-1": { error: "item not found", error_code: 404 },
			},
		});

		await expect(syncRequest("tok", { commands: "[]" })).rejects.toBeInstanceOf(
			SyncCommandError,
		);
	});

	it("does not throw when all sync_status entries are ok", async () => {
		replySync({
			sync_token: "tok",
			sync_status: { "uuid-1": "ok" },
		});

		await expect(syncRequest("tok", { commands: "[]" })).resolves.toBeDefined();
	});
});
