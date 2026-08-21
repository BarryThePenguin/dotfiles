import { createContainer } from "doist-core";
import {
	createInMemorySessionStateStore,
	createLocalTrackerModules,
	createTrackerSession,
	localTrackerRoot,
	selectTodoistRepoProjectId as pickRepoProjectId,
	type TrackerModules,
} from "issue-tools-core";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
// localTrackerRoot
// ---------------------------------------------------------------------------

describe("localTrackerRoot", () => {
	it("uses .scratch for the local tracker path", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		expect(localTrackerRoot(dir.path)).toBe(join(dir.path, ".scratch"));
	});
});

// ---------------------------------------------------------------------------
// createTrackerSession
// ---------------------------------------------------------------------------

describe("createTrackerSession", () => {
	const cwd = "/repo";

	function modules(): TrackerModules {
		return { issues: {}, wayfinder: {} } as unknown as TrackerModules;
	}

	it("selects and builds once for concurrent and subsequent requests", async () => {
		const built = modules();
		const selectMode = vi.fn(() => Promise.resolve("local" as const));
		const buildLocalModules = vi.fn(() => built);
		const buildTodoistModules = vi.fn();
		const session = createTrackerSession({
			cwd,
			selectMode,
			buildLocalModules,
			buildTodoistModules,
			store: createInMemorySessionStateStore(),
			updateStatus: vi.fn(),
		});

		const [first, concurrent, subsequent] = await Promise.all([
			session.getModules(),
			session.getModules(),
			session.getModules(),
		]);

		expect(selectMode).toHaveBeenCalledOnce();
		expect(buildLocalModules).toHaveBeenCalledOnce();
		expect(buildTodoistModules).not.toHaveBeenCalled();
		expect(first.modules).toBe(built);
		expect(concurrent.modules).toBe(built);
		expect(subsequent.modules).toBe(built);
	});

	it("caches the dev identity for the lifetime of the session", async () => {
		const session = createTrackerSession({
			cwd,
			selectMode: () => Promise.resolve("local" as const),
			buildLocalModules: () => modules(),
			buildTodoistModules: vi.fn(),
			store: createInMemorySessionStateStore(),
			updateStatus: vi.fn(),
		});

		vi.stubEnv("PI_ISSUE_TOOLS_CLAIMANT", "First dev");
		try {
			expect(await session.getClaimant()).toBe("First dev");
			vi.stubEnv("PI_ISSUE_TOOLS_CLAIMANT", "Second dev");
			// claimant is cached after first resolution
			expect(await session.getClaimant()).toBe("First dev");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("starts fresh selection and construction after invalidate", async () => {
		const firstModules = modules();
		const secondModules = modules();
		const selectMode = vi
			.fn()
			.mockResolvedValueOnce("local" as const)
			.mockResolvedValueOnce("todoist" as const);
		const buildLocalModules = vi
			.fn()
			.mockReturnValueOnce(firstModules)
			.mockReturnValueOnce(modules());
		const buildTodoistModules = vi.fn().mockResolvedValueOnce(secondModules);
		const session = createTrackerSession({
			cwd,
			selectMode,
			buildLocalModules,
			buildTodoistModules,
			store: createInMemorySessionStateStore(),
			updateStatus: vi.fn(),
		});

		const { modules: first } = await session.getModules();
		session.invalidate();
		const { modules: second } = await session.getModules();

		expect(selectMode).toHaveBeenCalledTimes(2);
		expect(buildLocalModules).toHaveBeenCalledOnce();
		expect(buildTodoistModules).toHaveBeenCalledOnce();
		expect(second).toBe(secondModules);
		expect(second).not.toBe(first);
	});

	it("does not cache a failed selection or construction", async () => {
		const error = new Error("temporary construction failure");
		const built = modules();
		const selectMode = vi.fn(() => Promise.resolve("local" as const));
		const buildLocalModules = vi
			.fn()
			.mockImplementationOnce(() => {
				throw error;
			})
			.mockReturnValueOnce(built);
		const buildTodoistModules = vi.fn();
		const session = createTrackerSession({
			cwd,
			selectMode,
			buildLocalModules,
			buildTodoistModules,
			store: createInMemorySessionStateStore(),
			updateStatus: vi.fn(),
		});

		await expect(session.getModules()).rejects.toThrow(error);
		await expect(session.getModules()).resolves.toMatchObject({
			modules: built,
		});
		expect(selectMode).toHaveBeenCalledTimes(2);
		expect(buildLocalModules).toHaveBeenCalledTimes(2);
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

describe("local modules ignore repo-aware project selection", () => {
	it("always build from .scratch regardless of the .doistrc", () => {
		using dir = tempDir();
		mkdirSync(join(dir.path, ".scratch"));
		writeRc(dir.path, [
			{ id: "first", label: "First" },
			{ id: "repo", label: "Repo", repo: true },
		]);
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		const modules = createLocalTrackerModules(localTrackerRoot(dir.path));
		expect(modules.issues).toBeDefined();
		expect(modules.wayfinder).toBeDefined();
	});
});
