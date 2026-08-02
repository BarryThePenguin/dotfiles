import { mkdirSync, writeFileSync, mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "issue-tools-core";
import {
	buildTrackerModules,
	createTrackerModules,
	detectTrackerSelection,
	localTrackerRoot,
	pickRepoProjectId,
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
// buildTrackerModules
// ---------------------------------------------------------------------------

describe("buildTrackerModules", () => {
	it("throws when TODOIST_API_TOKEN is missing", async () => {
		using dir = tempDir();
		writeFileSync(
			join(dir.path, ".doistrc"),
			'{"projects":[{"id":"p1","label":"Test"}]}\n',
		);
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(buildTrackerModules()).rejects.toThrow(
			/Expected "TODOIST_API_TOKEN" but received undefined/,
		);
	});

	it("throws when .doistrc has no projects", async () => {
		using dir = tempDir();
		writeFileSync(join(dir.path, ".doistrc"), '{"projects":[]}\n');
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(buildTrackerModules()).rejects.toThrow(
			"Could not create Todoist tracker: no-projects",
		);
	});

	it("throws when no .doistrc is found", async () => {
		using dir = tempDir();
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(buildTrackerModules()).rejects.toThrow(
			"Could not create Todoist tracker: no-config",
		);
	});
});

// ---------------------------------------------------------------------------
// createTrackerModules (no silent fallback: throws on Todoist build error)
// ---------------------------------------------------------------------------

describe("createTrackerModules", () => {
	it("throws when Todoist build fails", async () => {
		using dir = tempDir();
		writeFileSync(join(dir.path, ".doistrc"), '{"projects":[]}\n');
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(
			createTrackerModules({ cwd: dir.path, mode: "todoist" }),
		).rejects.toThrow("Could not create Todoist tracker: no-projects");
	});

	it("builds local Issue and Wayfinder modules", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));

		const modules = await createTrackerModules({
			cwd: dir.path,
			mode: "local",
		});
		expect(modules.issues).toBeDefined();
		expect(modules.wayfinder).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Repo-aware project selection (Ticket 4)
// ---------------------------------------------------------------------------

function writeRc(dir: string, projects: unknown) {
	writeFileSync(join(dir, ".doistrc"), JSON.stringify({ projects }), "utf8");
}

describe("pickRepoProjectId over a real .doistrc", () => {
	it("picks the project marked repo: true over the first-listed one", () => {
		using dir = tempDir();
		writeRc(dir.path, [
			{ id: "inbox", label: "Inbox" },
			{ id: "dotfiles", label: "Dotfiles", repo: true },
			{ id: "personal", label: "Personal" },
		]);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		const container = createContainer();
		expect(pickRepoProjectId(container)).toBe("dotfiles");
	});

	it("falls back to the first-listed project when no marker is present", () => {
		using dir = tempDir();
		writeRc(dir.path, [
			{ id: "first", label: "First" },
			{ id: "second", label: "Second" },
		]);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		const container = createContainer();
		expect(pickRepoProjectId(container)).toBe("first");
	});

	it("works on a shared .doistrc (personal projects + a marked repo project)", () => {
		using dir = tempDir();
		writeRc(dir.path, [
			{ id: "dotfiles", label: "Dotfiles", repo: true },
			{ id: "inbox", label: "Inbox" },
			{ id: "personal", label: "Personal" },
			{ id: "routines", label: "Routines" },
		]);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		const container = createContainer();
		expect(pickRepoProjectId(container)).toBe("dotfiles");
	});

	it("returns undefined when no .doistrc is found", () => {
		using dir = tempDir();
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", dir.path);
		const container = createContainer();
		expect(pickRepoProjectId(container)).toBeUndefined();
	});
});

describe("createTrackerModules repo-aware project selection", () => {
	it("the local modules ignore repo selection (always .scratch)", async () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		writeRc(dir.path, [
			{ id: "first", label: "First" },
			{ id: "repo", label: "Repo", repo: true },
		]);
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		const modules = await createTrackerModules({
			cwd: dir.path,
			mode: "local",
		});
		expect(modules.issues).toBeDefined();
		expect(modules.wayfinder).toBeDefined();
	});
});
