import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach,
	describe,
	expect,
	it,
	onTestFinished,
} from "vitest";
import { createContainer } from "./container.ts";


afterEach(() => {
	delete process.env["TODOIST_API_TOKEN"];
	delete process.env["TODOIST_RC_DIR"];
});

function setupContainer() {
	const tempDir = mkdtempDisposableSync(join(tmpdir(), "doist-container-test-"));

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

		expect(container.db).toBeNull();
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

	it("can still create a new .doistrc via projects add", () => {
		using tempDir = setupContainer();
		const container = createContainer();
		onTestFinished(() => {
			container.close();
		});

		container.addProject({ id: "p1", label: "Work" });
		expect(container.listProjectIds()).toEqual(["p1"]);
		expect(readFileSync(join(tempDir.path, ".doistrc"), "utf8")).toContain('"p1"');
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(false);
		expect(container.db).not.toBeNull();
		expect(existsSync(join(tempDir.path, "todoist.db"))).toBe(true);
	});
});
