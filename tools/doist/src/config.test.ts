import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./env.ts", () => ({
	env: new Proxy({}, { get: (_, k) => process.env[k as string] }),
}));
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	writeConfig,
	listProjects,
	addProject,
	removeProject,
	findPaths,
} from "./config.ts";

const work = { id: "111", label: "Work" };
const personal = { id: "222", label: "Personal" };

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "doistrc-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true });
});

const rcPath = () => join(dir, ".doistrc");

describe("listProjects", () => {
	it("returns empty list when file does not exist", () => {
		expect(listProjects(rcPath())).toEqual([]);
	});

	it("reads existing config", () => {
		writeConfig(rcPath(), { projects: [work, personal] });
		expect(listProjects(rcPath())).toEqual([work, personal]);
	});

	it("throws when file is malformed JSON", () => {
		writeFileSync(rcPath(), "not valid json");
		expect(() => listProjects(rcPath())).toThrow();
	});
});

describe("addProject", () => {
	it("adds a project entry", () => {
		addProject(rcPath(), work);
		expect(listProjects(rcPath())).toContainEqual(work);
	});

	it("is idempotent — adding the same id twice yields one entry", () => {
		addProject(rcPath(), work);
		addProject(rcPath(), work);
		const projects = listProjects(rcPath());
		expect(projects.filter((p) => p.id === work.id)).toHaveLength(1);
	});
});

describe("findPaths", () => {
	it("finds .doistrc in the given directory", () => {
		writeConfig(join(dir, ".doistrc"), { projects: [] });
		expect(findPaths(dir).rcPath).toBe(join(dir, ".doistrc"));
	});

	it("walks up to find .doistrc in a parent directory", () => {
		writeConfig(join(dir, ".doistrc"), { projects: [] });
		const child = mkdtempSync(join(dir, "child-"));
		expect(findPaths(child).rcPath).toBe(join(dir, ".doistrc"));
	});

	it("returns cwd/.doistrc when no file is found", () => {
		expect(findPaths(dir).rcPath).toBe(join(dir, ".doistrc"));
	});

	it("dbPath is co-located with rcPath", () => {
		writeConfig(join(dir, ".doistrc"), { projects: [] });
		const { rcPath, dbPath } = findPaths(dir);
		expect(dbPath).toBe(join(dir, "todoist.db"));
		expect(rcPath).toBe(join(dir, ".doistrc"));
	});

	it("respects TODOIST_RC_PATH env override", () => {
		const override = join(dir, "custom.rc");
		process.env["TODOIST_RC_PATH"] = override;
		try {
			expect(findPaths(dir).rcPath).toBe(override);
		} finally {
			delete process.env["TODOIST_RC_PATH"];
		}
	});

	it("respects TODOIST_DB_PATH env override", () => {
		const override = join(dir, "custom.db");
		process.env["TODOIST_DB_PATH"] = override;
		try {
			expect(findPaths(dir).dbPath).toBe(override);
		} finally {
			delete process.env["TODOIST_DB_PATH"];
		}
	});
});

describe("removeProject", () => {
	it("removes an existing entry by id", () => {
		writeConfig(rcPath(), { projects: [work, personal] });
		removeProject(rcPath(), work.id);
		const projects = listProjects(rcPath());
		expect(projects).not.toContainEqual(work);
		expect(projects).toContainEqual(personal);
	});

	it("is a no-op for a non-existent id", () => {
		writeConfig(rcPath(), { projects: [work] });
		removeProject(rcPath(), "999");
		expect(listProjects(rcPath())).toEqual([work]);
	});
});
