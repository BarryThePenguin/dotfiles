import { mkdirSync, writeFileSync, mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildTodoistTracker,
	createWayfinderTracker,
	detectTrackerSelection,
	localTrackerRoot,
} from "./tracker.ts";

// ---------------------------------------------------------------------------
// Env + tempdir plumbing
// ---------------------------------------------------------------------------

function tempDir() {
	const dir = mkdtempDisposableSync(join(tmpdir(), "wayfinder-tracker-"));
	mkdirSync(join(dir.path, ".git")); // stop the directory walk
	return dir;
}

beforeEach(() => {
	vi.stubEnv("TODOIST_API_TOKEN", undefined);
	vi.stubEnv("TODOIST_RC_DIR", undefined);
});

// ---------------------------------------------------------------------------
// detectTrackerSelection
// ---------------------------------------------------------------------------

describe("detectTrackerSelection", () => {
	it("returns 'local' when .scratch exists", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		expect(detectTrackerSelection(dir.path)).toBe("local");
	});

	it("returns 'todoist' when TODOIST_API_TOKEN and .doistrc are set", () => {
		using dir = tempDir();
		writeFileSync(
			join(dir.path, ".doistrc"),
			'{"projects":[{"id":"p1","label":"Test"}]}\n',
		);
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		expect(detectTrackerSelection(dir.path)).toBe("todoist");
	});

	it("returns null when no .scratch, no .doistrc, or no projects", () => {
		using dir = tempDir();
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;
		expect(detectTrackerSelection(dir.path)).toBeNull();
	});

	it("returns null when .doistrc has no projects", () => {
		using dir = tempDir();
		writeFileSync(join(dir.path, ".doistrc"), '{"projects":[]}\n');
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;
		expect(detectTrackerSelection(dir.path)).toBeNull();
	});

	it("prefers local over Todoist when both are configured", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		writeFileSync(
			join(dir.path, ".doistrc"),
			'{"projects":[{"id":"p1","label":"Test"}]}\n',
		);
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;
		expect(detectTrackerSelection(dir.path)).toBe("local");
	});

	it("uses .scratch for the local tracker path", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		expect(localTrackerRoot(dir.path)).toBe(join(dir.path, ".scratch"));
	});
});

// ---------------------------------------------------------------------------
// buildTodoistTracker
// ---------------------------------------------------------------------------

describe("buildTodoistTracker", () => {
	it("throws when TODOIST_API_TOKEN is missing", async () => {
		using dir = tempDir();
		writeFileSync(
			join(dir.path, ".doistrc"),
			'{"projects":[{"id":"p1","label":"Test"}]}\n',
		);
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(buildTodoistTracker()).rejects.toThrow(
			/Expected "TODOIST_API_TOKEN" but received undefined/,
		);
	});

	it("throws when .doistrc has no projects", async () => {
		using dir = tempDir();
		writeFileSync(join(dir.path, ".doistrc"), '{"projects":[]}\n');
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(buildTodoistTracker()).rejects.toThrow(
			"Could not create Todoist tracker: no-projects",
		);
	});

	it("throws when no .doistrc is found", async () => {
		using dir = tempDir();
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(buildTodoistTracker()).rejects.toThrow(
			"Could not create Todoist tracker: no-config",
		);
	});
});

// ---------------------------------------------------------------------------
// createWayfinderTracker (no silent fallback: throws on Todoist build error)
// ---------------------------------------------------------------------------

describe("createWayfinderTracker", () => {
	it("throws when Todoist build fails", async () => {
		using dir = tempDir();
		writeFileSync(join(dir.path, ".doistrc"), '{"projects":[]}\n');
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(
			createWayfinderTracker({ cwd: dir.path, mode: "todoist" }),
		).rejects.toThrow("Could not create Todoist tracker: no-projects");
	});

	it("builds a local tracker", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));

		const tracker = await createWayfinderTracker({
			cwd: dir.path,
			mode: "local",
		});
		expect(tracker).toBeDefined();
	});
});
