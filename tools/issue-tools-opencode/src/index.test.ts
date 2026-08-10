import type { Hooks, PluginInput, ToolContext } from "@opencode-ai/plugin";
import { mkdirSync, mkdtempDisposableSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.ts";

const input = {} as PluginInput;

async function hooks(): Promise<Hooks> {
	return plugin(input);
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
		const h = await hooks();
		expect(Object.keys(h.tool ?? {}).sort()).toEqual([
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

	it("gives every registered tool a description, args schema, and execute", async () => {
		const h = await hooks();
		for (const def of Object.values(h.tool ?? {})) {
			expect(def.description).toBeTruthy();
			expect(def.args).toBeDefined();
			expect(typeof def.execute).toBe("function");
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

		const h = await hooks();
		const setup = h.tool?.["issue_tracker_setup"];
		const result = await setup.execute({}, {
			worktree: dir.path,
			metadata: () => ({ id: "t1", title: "Test" }),
		} as ToolContext);

		expect((result as { output: string }).output).toContain(
			"Marked p1 as the repo project",
		);
		const rc = JSON.parse(
			await readFile(join(dir.path, ".doistrc"), "utf8"),
		) as { projects: { id: string; repo?: boolean }[] };
		expect(rc.projects[0].repo).toBe(true);
	});
});
