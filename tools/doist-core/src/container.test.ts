import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createContainer } from "./container.ts";

beforeEach(() => {
	vi.stubEnv("TODOIST_API_TOKEN", undefined);
	vi.stubEnv("TODOIST_RC_DIR", undefined);
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

		expect(() => container.db).toThrow(
			"no .doistrc found in this git repository",
		);
		expect(container.paths).toBeNull();
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(false);
	});

	it("does not create the db file until db is first accessed", () => {
		using tempDir = setupContainer();
		const rcPath = join(tempDir.path, ".doistrc");
		writeFileSync(rcPath, JSON.stringify({ projects: [] }), "utf8");
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(false);
		expect(container.paths?.dbPath).toBe(join(tempDir.path, "todoist.db"));
		expect(container.db).not.toBeNull();
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(true);
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
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		container.addProject({ id: "p1", label: "Work" });
		expect(container.listProjectIds()).toEqual(["p1"]);
		expect(readFileSync(join(tempDir.path, ".doistrc"), "utf8")).toContain(
			'"p1"',
		);
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(false);
		expect(container.db).not.toBeNull();
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(true);
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
