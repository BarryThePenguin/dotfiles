import { mkdirSync, mkdtempDisposableSync, type DisposableTempDir } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileStateStore } from "issue-tools-core";
import { createSessionRegistry } from "./tracker.ts";

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "issue-tools-opencode-tracker-"));
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

describe("createSessionRegistry", () => {
	it("wires sessions to the 'opencode' state-store host", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const registry = createSessionRegistry();
		const session = registry.get(dir.path);
		session.setActiveMap("map-1");

		const store = createFileStateStore<{ activeMap: string | null }>(
			dir.path,
			"opencode",
			{ activeMap: null },
		);
		expect(store.read().activeMap).toBe("map-1");
	});

	it("caches one session per worktree", () => {
		using dir = tempDir();
		const registry = createSessionRegistry();
		expect(registry.get(dir.path)).toBe(registry.get(dir.path));
	});

	it("keeps separate worktrees on separate sessions", () => {
		using dirA = tempDir();
		using dirB = tempDir();
		const registry = createSessionRegistry();
		expect(registry.get(dirA.path)).not.toBe(registry.get(dirB.path));
	});
});
