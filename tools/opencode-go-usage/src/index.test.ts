import * as undici from "undici";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenCodeGoUsageClient } from "./client.ts";

const usage = {
	rolling: { percent: 12, resetsAt: "2026-01-02T00:00:00Z" },
	weekly: { percent: 8, resetsAt: "2026-01-03T00:00:00Z" },
	monthly: { percent: 35, resetsAt: "2026-02-01T00:00:00Z" },
};

async function cachePath() {
	return join(
		await mkdtemp(join(tmpdir(), "opencode-go-usage-")),
		"usage.sqlite",
	);
}

const mockAgent = new undici.MockAgent();
mockAgent.disableNetConnect();
undici.setGlobalDispatcher(mockAgent);

afterEach(() => {
	mockAgent.assertNoPendingInterceptors();
});

const mockFetch = undici.fetch as unknown as typeof globalThis.fetch;

function interceptUsage(status = 200, body: object = { usage }) {
	return mockAgent
		.get("https://opencode.ai")
		.intercept({ path: "/zen/go/v1/usage", method: "GET" })
		.reply(status, body);
}

describe("OpenCodeGoUsageClient", () => {
	it("fetches, validates, and caches usage", async () => {
		const path = await cachePath();
		interceptUsage();
		const now = () => Date.parse("2026-01-01T00:00:00Z");
		const client = new OpenCodeGoUsageClient({
			apiKey: "secret",
			databasePath: path,
			fetch: mockFetch,
			now,
		});

		const result = await client.get();

		expect(result).toMatchObject({ usage, source: "network", stale: false });

		const cachedClient = new OpenCodeGoUsageClient({
			apiKey: "secret",
			databasePath: path,
			fetch: mockFetch,
			now,
		});
		expect(await cachedClient.get()).toMatchObject({ usage, source: "cache" });
	});

	it("returns stale cache when the network request fails", async () => {
		const path = await cachePath();
		let current = Date.parse("2026-01-01T00:00:00Z");
		const options = {
			apiKey: "secret",
			databasePath: path,
			fetch: mockFetch,
			now: () => current,
		};
		interceptUsage();
		await new OpenCodeGoUsageClient(options).get();
		mockAgent
			.get("https://opencode.ai")
			.intercept({ path: "/zen/go/v1/usage", method: "GET" })
			.replyWithError(new Error("offline"));
		current += 20 * 60 * 1000;

		await expect(
			new OpenCodeGoUsageClient(options).get(),
		).resolves.toMatchObject({
			usage,
			stale: true,
			error: "fetch failed",
		});
	});

	it("does not make a request without an API key", async () => {
		vi.stubEnv("OPENCODE_API_KEY", undefined);

		const result = await new OpenCodeGoUsageClient({
			databasePath: await cachePath(),
		}).get();
		expect(result).toMatchObject({ usage: null, source: "none" });
	});

	it("rejects malformed usage responses", async () => {
		interceptUsage(200, {
			usage: { ...usage, weekly: { percent: 101, resetsAt: "x" } },
		});
		const result = await new OpenCodeGoUsageClient({
			apiKey: "secret",
			databasePath: await cachePath(),
			fetch: mockFetch,
		}).get();
		expect(result).toMatchObject({
			usage: null,
			error: "invalid weekly window",
		});
	});
});
