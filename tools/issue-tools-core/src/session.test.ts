import {
	mkdirSync,
	mkdtempDisposableSync,
	type DisposableTempDir,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileStateStore } from "./state.ts";
import {
	createFileBackedTrackerSession,
	resolveTrackerMode,
	type TrackerMode,
} from "./session.ts";

type FileBackedSessionState = { mode?: TrackerMode; activeMap: string | null };
function storeFor(worktree: string, host: string) {
	return createFileStateStore<FileBackedSessionState>(worktree, host, {
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

describe("resolveTrackerMode", () => {
	it("returns local when only .scratch exists", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		expect(resolveTrackerMode(dir.path, undefined)).toBe("local");
	});

	it("returns todoist when only a configured .doistrc exists", async () => {
		using dir = tempDir();
		await writeFile(
			join(dir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
		);
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		expect(resolveTrackerMode(dir.path, undefined)).toBe("todoist");
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
		expect(resolveTrackerMode(dir.path, undefined)).toBe("local");
	});

	it("returns local when neither marker is present", () => {
		using dir = tempDir();
		expect(resolveTrackerMode(dir.path, undefined)).toBe("local");
	});

	it("lets an explicit override win over the markers", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		expect(resolveTrackerMode(dir.path, "todoist")).toBe("todoist");
		expect(resolveTrackerMode(dir.path, "local")).toBe("local");
	});
});

describe("createFileBackedTrackerSession", () => {
	it("round-trips mode and activeMap through the cache file", () => {
		using dir = tempDir();
		const store = storeFor(dir.path, "test-host");
		expect(store.read()).toEqual({ activeMap: null });

		store.write({ mode: "todoist", activeMap: "map-1" });
		expect(store.read()).toEqual({ mode: "todoist", activeMap: "map-1" });

		store.write({ activeMap: null });
		expect(store.read()).toEqual({ activeMap: null });
	});

	it("keys separate worktrees to separate state files", () => {
		using dirA = tempDir();
		using dirB = tempDir();
		storeFor(dirA.path, "test-host").write({
			mode: "local",
			activeMap: "map-a",
		});
		expect(storeFor(dirB.path, "test-host").read()).toEqual({
			activeMap: null,
		});
	});

	it("keys separate hosts to separate state files", () => {
		using dir = tempDir();
		storeFor(dir.path, "host-a").write({ mode: "local", activeMap: "map-a" });
		expect(storeFor(dir.path, "host-b").read()).toEqual({ activeMap: null });
	});

	it("builds local modules when the repo is in local mode", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const session = createFileBackedTrackerSession(dir.path, "test-host");
		const { modules, mode } = await session.getModules();
		expect(modules.issues).toBeDefined();
		expect(modules.wayfinder).toBeDefined();
		expect(mode).toBe("local");
	});

	it("persists the active map and restores it on a fresh session", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const session = createFileBackedTrackerSession(dir.path, "test-host");
		session.setActiveMap("map-1");
		expect(storeFor(dir.path, "test-host").read().activeMap).toBe("map-1");

		const restored = createFileBackedTrackerSession(dir.path, "test-host");
		expect(restored.getActiveMap()).toBe("map-1");
	});

	it("applies a tracker-mode override and persists it across sessions", () => {
		using dir = tempDir();
		const session = createFileBackedTrackerSession(dir.path, "test-host");
		session.setTrackerMode("todoist");
		expect(storeFor(dir.path, "test-host").read().mode).toBe("todoist");

		const fresh = createFileBackedTrackerSession(dir.path, "test-host");
		expect(fresh.getActiveMap()).toBeNull();
		expect(storeFor(dir.path, "test-host").read().mode).toBe("todoist");
	});

	it("preserves the active map when the tracker-mode override changes", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const session = createFileBackedTrackerSession(dir.path, "test-host");
		session.setActiveMap("map-1");
		session.setTrackerMode("todoist");
		expect(storeFor(dir.path, "test-host").read()).toEqual({
			mode: "todoist",
			activeMap: "map-1",
		});
	});

	it("clearing to auto drops the override and re-detects local", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		const session = createFileBackedTrackerSession(dir.path, "test-host");
		session.setTrackerMode("todoist");
		session.setTrackerMode("auto");
		expect(storeFor(dir.path, "test-host").read().mode).toBeUndefined();

		const { modules, mode } = await session.getModules();
		expect(mode).toBe("local");
		expect(modules.wayfinder).toBeDefined();
	});

	it("forced todoist with no Todoist config rejects with a clear error", async () => {
		using dir = tempDir();
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", join(dir.path, "does-not-exist"));
		const session = createFileBackedTrackerSession(dir.path, "test-host");
		session.setTrackerMode("todoist");
		await expect(session.getModules()).rejects.toThrow(
			"Could not create Todoist tracker: no-config",
		);
	});
});
