import type { Plugin } from "@opencode-ai/plugin/effect";
import { Effect } from "effect";
import { mkdirSync, mkdtempDisposableSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.ts";

type ToolDraft = {
	add: (tool: { name: string; [k: string]: unknown }) => void;
};

async function setupPlugin() {
	const tools = new Map<
		string,
		{
			[k: string]: unknown;
			name: string;
		}
	>();
	const mockSession = { get: vi.fn() };

	const ctx = {
		app: { name: "opencode", version: "test", channel: "test" },
		options: {},
		session: mockSession,
		tool: {
			transform: (callback: (draft: ToolDraft) => void) => {
				callback({ add: (tool) => tools.set(tool.name, tool) });
				return Effect.succeed({ dispose: Effect.void });
			},
		},
	} as unknown as Plugin.Context;

	await Effect.runPromise(Effect.scoped(plugin.effect(ctx)));

	return { tools, mockSession };
}

function makeCtx() {
	return {
		sessionID: "s1",
		agent: "a1",
		messageID: "m1",
		id: "t1",
		progress: vi.fn().mockReturnValue(Effect.void),
	};
}

let cacheDir: ReturnType<typeof mkdtempDisposableSync>;

beforeEach(() => {
	cacheDir = mkdtempDisposableSync(join(tmpdir(), "issue-tools-cache-"));
});

afterEach(() => {
	cacheDir[Symbol.dispose]();
	vi.unstubAllEnvs();
});

describe("plugin surface", () => {
	it("registers every wayfinder_* and issue_* tool exactly once plus setup", async () => {
		const { tools } = await setupPlugin();
		expect([...tools.keys()].sort()).toEqual([
			"issue_close",
			"issue_comment",
			"issue_create",
			"issue_label",
			"issue_list",
			"issue_read",
			"issue_tracker_setup",
			"wayfinder_chart",
			"wayfinder_claim",
			"wayfinder_create_ticket",
			"wayfinder_get_map",
			"wayfinder_get_ticket",
			"wayfinder_list_frontier",
			"wayfinder_list_maps",
			"wayfinder_resolve",
			"wayfinder_set_blocking",
			"wayfinder_update_map",
		]);
	});

	it("gives every registered tool a description, input schema, and execute", async () => {
		const { tools } = await setupPlugin();
		for (const def of tools.values()) {
			expect(def["description"]).toBeTruthy();
			expect(def["input"]).toBeDefined();
			expect(typeof def["execute"]).toBe("function");
		}
	});
});

describe("issue_tracker_setup", () => {
	it("marks the single todoist project as the repo project", async () => {
		using dir = mkdtempDisposableSync(join(tmpdir(), "issue-tools-setup-"));
		mkdirSync(join(dir.path, ".git"));
		await writeFile(
			join(dir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
		);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		vi.stubEnv("XDG_CACHE_HOME", cacheDir.path);

		const { tools, mockSession } = await setupPlugin();
		const setup = tools.get("issue_tracker_setup") as
			| {
					execute: (
						args: Record<string, never>,
						ctx: ReturnType<typeof makeCtx>,
					) => Effect.Effect<unknown>;
			  }
			| undefined;
		if (!setup?.execute) {
			throw new Error("issue_tracker_setup tool was not registered");
		}
		const ctx = makeCtx();
		mockSession.get.mockReturnValue(
			Effect.succeed({ location: { directory: dir.path } }),
		);

		const result = await Effect.runPromise(setup.execute({}, ctx));

		expect((result as { output: string }).output).toContain(
			"Marked p1 as the repo project",
		);
		const rc = JSON.parse(
			await readFile(join(dir.path, ".doistrc"), "utf8"),
		) as { projects: { id: string; repo?: boolean }[] };
		expect(rc.projects[0]?.repo).toBe(true);
	});
});
