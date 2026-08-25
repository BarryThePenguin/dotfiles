import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createContainer, centralDbPath, hasProjects } from "./container.ts";
import { NOW } from "./test-helpers/fixtures.ts";

beforeEach(() => {
	vi.stubEnv("TODOIST_API_TOKEN", undefined);
	vi.stubEnv("TODOIST_RC_DIR", undefined);
	vi.stubEnv("XDG_CACHE_HOME", undefined);
});

function setupContainer() {
	const tempDir = mkdtempDisposableSync(
		join(tmpdir(), "doist-container-test-"),
	);

	process.env["TODOIST_API_TOKEN"] = "test-token";
	process.env["TODOIST_RC_DIR"] = tempDir.path;

	mkdirSync(join(tempDir.path, ".git"));

	return tempDir;
}

describe("createContainer", () => {
	it("does not open a db when no .doistrc exists in the git repo", () => {
		using tempDir = setupContainer();
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		expect(() => container.queries).toThrow(
			"no .doistrc found in this git repository",
		);
		expect(container.paths).toBeNull();
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(false);
	});

	it("does not create the db file until queries is first accessed", () => {
		using tempDir = setupContainer();
		const cacheHome = join(tempDir.path, "shared");
		const dbFile = join(cacheHome, "doist", "todoist.db");
		vi.stubEnv("XDG_CACHE_HOME", cacheHome);
		const rcPath = join(tempDir.path, ".doistrc");
		writeFileSync(rcPath, JSON.stringify({ projects: [] }), "utf8");
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		expect(existsSync(dbFile)).toBe(false);
		expect(container.paths?.rcPath).toBe(rcPath);
		expect(container.queries).not.toBeNull();
		expect(existsSync(dbFile)).toBe(true);
	});

	it("resolves config from a passed rcDir instead of env or cwd", () => {
		using tempDir = setupContainer();
		const otherDir = mkdtempDisposableSync(join(tmpdir(), "doist-rc-dir-"));
		mkdirSync(join(otherDir.path, ".git"));
		writeFileSync(
			join(otherDir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "q1", label: "Other" }] }),
			"utf8",
		);
		// TODOIST_RC_DIR points at tempDir; the passed dir must win.
		const container = createContainer(otherDir.path);
		onTestFinished(() => {
			container.close();
		});

		expect(container.listProjectIds()).toEqual(["q1"]);
		expect(existsSync(join(tempDir.path, ".doistrc"))).toBe(false);
	});

	it("can still create a new .doistrc via projects add", () => {
		using tempDir = setupContainer();
		const cacheHome = join(tempDir.path, "shared");
		const dbFile = join(cacheHome, "doist", "todoist.db");
		vi.stubEnv("XDG_CACHE_HOME", cacheHome);
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		container.addProject({ id: "p1", label: "Work" });
		expect(container.listProjectIds()).toEqual(["p1"]);
		expect(readFileSync(join(tempDir.path, ".doistrc"), "utf8")).toContain(
			'"p1"',
		);
		expect(existsSync(dbFile)).toBe(false);
		expect(container.queries).not.toBeNull();
		expect(existsSync(dbFile)).toBe(true);
	});

	it("leaves no temp file behind after writing .doistrc", () => {
		using tempDir = setupContainer();
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		container.addProject({ id: "p1", label: "Work" });
		expect(readdirSync(tempDir.path).sort()).toEqual([".doistrc", ".git"]);
	});

	it("sees projects added by another container instance in the same process", () => {
		using _tempDir = setupContainer();
		const writer = createContainer();
		const reader = createContainer();
		onTestFinished(() => {
			writer.close();
			reader.close();
		});

		// Populate the reader's cache before the writer mutates the file.
		expect(reader.listProjects()).toEqual([]);
		writer.addProject({ id: "p1", label: "Work" });
		expect(reader.listProjects()).toContainEqual({
			id: "p1",
			label: "Work",
		});
	});

	// ── repo: true marker (repo-aware project selection) ─────────────

	it("parses existing .doistrc files that do not yet carry a repo marker", () => {
		using tempDir = setupContainer();
		const rcPath = join(tempDir.path, ".doistrc");
		writeFileSync(
			rcPath,
			'{"projects":[{"id":"p1","label":"Work"},{"id":"p2","label":"Personal"}]}\n',
			"utf8",
		);
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		expect(container.listProjects()).toEqual([
			{ id: "p1", label: "Work" },
			{ id: "p2", label: "Personal" },
		]);
	});

	it("can sync via container.sync() without accessing db or client directly", () => {
		using tempDir = setupContainer();
		const rcPath = join(tempDir.path, ".doistrc");
		writeFileSync(
			rcPath,
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
			"utf8",
		);
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		expect(container.sync).toBeTypeOf("function");
	});

	// ── central shared database ──────────────────────────────────────

	it("multiple repos share one physical store; .doistrc is only a lens", () => {
		using tempDir = mkdtempDisposableSync(join(tmpdir(), "doist-shared-db-"));
		const cacheHome = join(tempDir.path, "central");
		vi.stubEnv("XDG_CACHE_HOME", cacheHome);

		const repoA = join(tempDir.path, "repo-a");
		const repoB = join(tempDir.path, "repo-b");
		mkdirSync(join(repoA, ".git"), { recursive: true });
		mkdirSync(join(repoB, ".git"), { recursive: true });
		writeFileSync(
			join(repoA, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "A" }] }),
			"utf8",
		);
		writeFileSync(
			join(repoB, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p2", label: "B" }] }),
			"utf8",
		);

		const containerA = createContainer(repoA);
		const containerB = createContainer(repoB);
		onTestFinished(() => {
			containerA.close();
			containerB.close();
		});

		containerA.db.upsertProject({
			id: "p1",
			name: "A",
			color: null,
			is_favorite: 0,
			is_inbox: 0,
			synced_at: NOW,
		});

		// Repo B's consumer reads the same physical rows through its own
		// connection; scoping is applied at query time via the project lens.
		expect(containerB.db.getProjectById("p1")?.name).toBe("A");
		expect(existsSync(join(repoA, "todoist.db"))).toBe(false);
		expect(existsSync(join(repoB, "todoist.db"))).toBe(false);
	});

	it("ignores a stale per-repo todoist.db left over from before the central store", () => {
		using tempDir = mkdtempDisposableSync(join(tmpdir(), "doist-legacy-db-"));
		const cacheHome = join(tempDir.path, "central");
		vi.stubEnv("XDG_CACHE_HOME", cacheHome);

		const repo = join(tempDir.path, "repo");
		mkdirSync(join(repo, ".git"), { recursive: true });
		writeFileSync(
			join(repo, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "A" }] }),
			"utf8",
		);

		// A leftover database from the per-repo era, holding a row the central
		// store has never seen.
		writeFileSync(join(repo, "todoist.db"), "not even sqlite", "utf8");

		const container = createContainer(repo);
		onTestFinished(() => {
			container.close();
		});

		container.db.upsertProject({
			id: "p1",
			name: "A",
			color: null,
			is_favorite: 0,
			is_inbox: 0,
			synced_at: NOW,
		});

		// The legacy file is neither read (the bogus content never breaks the
		// container) nor written to — it is dead weight the user can delete.
		expect(readFileSync(join(repo, "todoist.db"), "utf8")).toBe(
			"not even sqlite",
		);
		expect(existsSync(centralDbPath())).toBe(true);
	});

	it("setRepoProject marks the given project, removing the marker from any other", () => {
		using tempDir = setupContainer();
		const rcPath = join(tempDir.path, ".doistrc");
		writeFileSync(
			rcPath,
			'{"projects":[{"id":"p1","label":"Work"},{"id":"p2","label":"Personal"}]}\n',
			"utf8",
		);
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		container.setRepoProject("p2");
		expect(container.listProjects()).toEqual([
			{ id: "p1", label: "Work" },
			{ id: "p2", label: "Personal", repo: true },
		]);

		container.setRepoProject("p1");
		expect(container.listProjects()).toEqual([
			{ id: "p1", label: "Work", repo: true },
			{ id: "p2", label: "Personal" },
		]);
	});
});

describe("hasProjects", () => {
	it("returns false when no .doistrc exists", () => {
		using tempDir = mkdtempDisposableSync(
			join(tmpdir(), "doist-has-projects-"),
		);
		mkdirSync(join(tempDir.path, ".git"));
		expect(hasProjects(tempDir.path)).toBe(false);
	});

	it("returns false when .doistrc has no projects", () => {
		using tempDir = mkdtempDisposableSync(
			join(tmpdir(), "doist-has-projects-"),
		);
		mkdirSync(join(tempDir.path, ".git"));
		writeFileSync(
			join(tempDir.path, ".doistrc"),
			JSON.stringify({ projects: [] }),
			"utf8",
		);
		expect(hasProjects(tempDir.path)).toBe(false);
	});

	it("returns true when .doistrc has at least one project", () => {
		using tempDir = mkdtempDisposableSync(
			join(tmpdir(), "doist-has-projects-"),
		);
		mkdirSync(join(tempDir.path, ".git"));
		writeFileSync(
			join(tempDir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
			"utf8",
		);
		expect(hasProjects(tempDir.path)).toBe(true);
	});

	it("returns false when .doistrc is malformed JSON", () => {
		using tempDir = mkdtempDisposableSync(
			join(tmpdir(), "doist-has-projects-"),
		);
		mkdirSync(join(tempDir.path, ".git"));
		writeFileSync(join(tempDir.path, ".doistrc"), "not-json", "utf8");
		expect(hasProjects(tempDir.path)).toBe(false);
	});

	it("does not open a database file", () => {
		using tempDir = mkdtempDisposableSync(
			join(tmpdir(), "doist-has-projects-"),
		);
		mkdirSync(join(tempDir.path, ".git"));
		writeFileSync(
			join(tempDir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
			"utf8",
		);
		hasProjects(tempDir.path);
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(false);
	});

	// ── rc discovery walk ────────────────────────────────────────────

	it("discovers .doistrc in a parent directory of the given rcDir", () => {
		using tempDir = setupContainer();
		writeFileSync(
			join(tempDir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
			"utf8",
		);
		const child = join(tempDir.path, "deeply", "nested");
		mkdirSync(child, { recursive: true });

		const container = createContainer(child);
		onTestFinished(() => {
			container.close();
		});

		expect(container.listProjectIds()).toEqual(["p1"]);
		expect(container.paths?.rcPath).toBe(join(tempDir.path, ".doistrc"));
	});
});

// ── centralDbPath ──────────────────────────────────────────────────

describe("centralDbPath", () => {
	it("defaults to ~/.cache/doist/todoist.db", () => {
		expect(centralDbPath({ env: {}, home: "/home/tester" })).toBe(
			"/home/tester/.cache/doist/todoist.db",
		);
	});

	it("honors XDG_CACHE_HOME when absolute", () => {
		expect(
			centralDbPath({
				env: { XDG_CACHE_HOME: "/tmp/cache" },
				home: "/home/tester",
			}),
		).toBe("/tmp/cache/doist/todoist.db");
	});

	it("ignores a relative XDG_CACHE_HOME per the XDG spec", () => {
		expect(
			centralDbPath({
				env: { XDG_CACHE_HOME: "relative/cache" },
				home: "/home/tester",
			}),
		).toBe("/home/tester/.cache/doist/todoist.db");
	});
});
