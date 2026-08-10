import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTodoistTrackerModules } from "./todoist-tracker-factory.ts";

function tempDir() {
	const dir = mkdtempDisposableSync(join(tmpdir(), "wayfinder-todoist-"));
	mkdirSync(join(dir.path, ".git")); // stop the directory walk
	return dir;
}

beforeEach(() => {
	vi.stubEnv("TODOIST_API_TOKEN", undefined);
	vi.stubEnv("TODOIST_RC_DIR", undefined);
});

describe("createTodoistTrackerModules", () => {
	it("throws when TODOIST_API_TOKEN is missing", async () => {
		using dir = tempDir();
		writeFileSync(
			join(dir.path, ".doistrc"),
			'{"projects":[{"id":"p1","label":"Test"}]}\n',
		);
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(
			createTodoistTrackerModules((path) => new DatabaseSync(path)),
		).rejects.toThrow(/Expected "TODOIST_API_TOKEN" but received undefined/);
	});

	it("throws when .doistrc has no projects", async () => {
		using dir = tempDir();
		writeFileSync(join(dir.path, ".doistrc"), '{"projects":[]}\n');
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(
			createTodoistTrackerModules((path) => new DatabaseSync(path)),
		).rejects.toThrow("Could not create Todoist tracker: no-projects");
	});

	it("throws when no .doistrc is found", async () => {
		using dir = tempDir();
		process.env["TODOIST_API_TOKEN"] = "test";
		process.env["TODOIST_RC_DIR"] = dir.path;

		await expect(
			createTodoistTrackerModules((path) => new DatabaseSync(path)),
		).rejects.toThrow("Could not create Todoist tracker: no-config");
	});
});
