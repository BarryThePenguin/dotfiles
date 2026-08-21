import {
	mkdirSync,
	mkdtempDisposableSync,
	type DisposableTempDir,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileStateStore, type TrackerMode } from "issue-tools-core";
import { createOpenCodeSession, resolveMode } from "./tracker.ts";

type SessionState = { mode?: TrackerMode; activeMap: string | null };
function storeFor(worktree: string) {
	return createFileStateStore<SessionState>(worktree, "opencode", {
		activeMap: null,
	});
}

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "issue-tools-tracker-"));
}

let cacheDir: DisposableTempDir;

beforeEach(() => {
	cacheDir = mkdtempDisposableSync(join(tmpdir(), "issue-tools-cache-"));
	process.env["XDG_CACHE_HOME"] = cacheDir.path;
});

afterEach(() => {
	cacheDir[Symbol.dispose]();
	delete process.env["XDG_CACHE_HOME"];
	vi.unstubAllEnvs();
});

describe("resolveMode", () => {
	it("returns local when only .scratch exists", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		expect(resolveMode(dir.path, undefined)).toBe("local");
	});

	it("returns todoist when only a configured .doistrc exists", async () => {
		using dir = tempDir();
		await writeFile(
			join(dir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
		);
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		expect(resolveMode(dir.path, undefined)).toBe("todoist");
	});

	it("returns local when both markers are present (no UI to prompt)", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		await writeFile(
			join(dir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
		);
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		expect(resolveMode(dir.path, undefined)).toBe("local");
	});

	it("returns local when neither marker is present", () => {
		using dir = tempDir();
		expect(resolveMode(dir.path, undefined)).toBe("local");
	});

	it("lets an explicit override win over the markers", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		expect(resolveMode(dir.path, "todoist")).toBe("todoist");
		expect(resolveMode(dir.path, "local")).toBe("local");
	});
});

describe("state store", () => {
	it("round-trips mode and activeMap through the cache file", () => {
		using dir = tempDir();
		const store = storeFor(dir.path);
		expect(store.read()).toEqual({ activeMap: null });

		store.write({ mode: "todoist", activeMap: "map-1" });
		expect(store.read()).toEqual({ mode: "todoist", activeMap: "map-1" });

		store.write({ activeMap: null });
		expect(store.read()).toEqual({ activeMap: null });
	});

	it("keys separate worktrees to separate state files", () => {
		using dirA = tempDir();
		using dirB = tempDir();
		storeFor(dirA.path).write({ mode: "local", activeMap: "map-a" });
		expect(storeFor(dirB.path).read()).toEqual({ activeMap: null });
	});
});

describe("session lifecycle", () => {
	it("builds local modules when the repo is in local mode", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const session = createOpenCodeSession(dir.path);
		const { modules, mode } = await session.getModules();
		expect(modules.issues).toBeDefined();
		expect(modules.wayfinder).toBeDefined();
		expect(mode).toBe("local");
	});

	it("persists the active map and restores it on a fresh session", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const session = createOpenCodeSession(dir.path);
		session.setActiveMap("map-1");
		expect(storeFor(dir.path).read().activeMap).toBe("map-1");

		const restored = createOpenCodeSession(dir.path);
		expect(restored.getActiveMap()).toBe("map-1");
	});

	it("applies a tracker-mode override and persists it across sessions", () => {
		using dir = tempDir();
		const session = createOpenCodeSession(dir.path);
		session.setTrackerMode("todoist");
		expect(storeFor(dir.path).read().mode).toBe("todoist");

		const fresh = createOpenCodeSession(dir.path);
		expect(fresh.getActiveMap()).toBeNull();
		expect(storeFor(dir.path).read().mode).toBe("todoist");
	});

	it("clearing to auto drops the override and re-detects local", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const session = createOpenCodeSession(dir.path);
		session.setTrackerMode("todoist");
		session.setTrackerMode("auto");
		expect(storeFor(dir.path).read().mode).toBeUndefined();

		const { modules, mode } = await session.getModules();
		expect(mode).toBe("local");
		expect(modules.wayfinder).toBeDefined();
	});

	it("forced todoist with no Todoist config rejects with a clear error", async () => {
		using dir = tempDir();
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", join(dir.path, "does-not-exist"));
		const session = createOpenCodeSession(dir.path);
		session.setTrackerMode("todoist");
		await expect(session.getModules()).rejects.toThrow(
			"Could not create Todoist tracker: no-config",
		);
	});
});
