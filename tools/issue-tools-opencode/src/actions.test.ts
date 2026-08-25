import { mkdtempDisposableSync, type DisposableTempDir } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalTrackerModules, localTrackerRoot } from "issue-tools-core";
import { handleAction } from "./actions.ts";
import { createOpenCodeSession } from "./tracker.ts";

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "issue-tools-opencode-"));
}

let cacheDir: DisposableTempDir;

beforeEach(() => {
	cacheDir = mkdtempDisposableSync(join(tmpdir(), "issue-tools-cache-"));
	process.env["XDG_CACHE_HOME"] = cacheDir.path;
});

afterEach(() => {
	cacheDir[Symbol.dispose]();
	delete process.env["XDG_CACHE_HOME"];
});

// Business-logic coverage for every action lives in
// issue-tools-core/src/actions.test.ts. These tests only prove that the
// OpenCode session wires correctly into the shared runtime and that results
// are shaped into OpenCode's { output, metadata } format.
describe("OpenCode action wiring", () => {
	it("shapes a successful result as { output, metadata }", async () => {
		using dir = tempDir();
		const session = createOpenCodeSession(dir.path);

		const result = await handleAction("list_maps", {}, session);

		expect(result).toEqual({
			output: "No open wayfinder maps.",
			metadata: expect.any(Object) as unknown,
		});
	});

	it("shapes an error result as Error: <message> with empty metadata", async () => {
		using dir = tempDir();
		const session = createOpenCodeSession(dir.path);

		const result = await handleAction("get_map", {}, session);

		expect(result.output).toBe("Error: no map_id provided and no active map.");
		expect(result.metadata).toEqual({});
	});

	it("carries session state through the runtime (active map persists)", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		const map = await modules.wayfinder.createMap({
			title: "GENIE 2780",
			destination: "A clear handoff exists.",
		});
		const session = createOpenCodeSession(dir.path);

		await handleAction("list_maps", {}, session);

		expect(session.getActiveMap()).toBe(map.id);
	});
});
