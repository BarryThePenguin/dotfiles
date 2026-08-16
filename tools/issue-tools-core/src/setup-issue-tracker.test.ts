import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectTrackerSelection } from "./setup-issue-tracker.ts";

function tempRepo() {
	const dir = mkdtempDisposableSync(join(tmpdir(), "issue-tools-setup-"));
	mkdirSync(join(dir.path, ".git")); // stop the upward .doistrc walk
	return dir;
}

function writeRc(dir: string, projects: unknown) {
	writeFileSync(join(dir, ".doistrc"), JSON.stringify({ projects }), "utf8");
}

describe("detectTrackerSelection", () => {
	it("returns 'local' when .scratch exists", () => {
		using dir = tempRepo();
		mkdirSync(join(dir.path, ".scratch"));
		expect(detectTrackerSelection(dir.path)).toBe("local");
	});

	it("returns 'todoist' when a .doistrc with projects is reachable", () => {
		using dir = tempRepo();
		writeRc(dir.path, [{ id: "p1", label: "Test" }]);
		expect(detectTrackerSelection(dir.path)).toBe("todoist");
	});

	it("returns 'both' when .scratch and a populated .doistrc exist", () => {
		using dir = tempRepo();
		mkdirSync(join(dir.path, ".scratch"));
		writeRc(dir.path, [{ id: "p1", label: "Test" }]);
		expect(detectTrackerSelection(dir.path)).toBe("both");
	});

	it("returns 'neither' when no markers exist", () => {
		using dir = tempRepo();
		expect(detectTrackerSelection(dir.path)).toBe("neither");
	});

	it("returns 'neither' when .doistrc has no projects", () => {
		using dir = tempRepo();
		writeRc(dir.path, []);
		expect(detectTrackerSelection(dir.path)).toBe("neither");
	});

	it("returns 'neither' for a malformed .doistrc", () => {
		using dir = tempRepo();
		writeFileSync(join(dir.path, ".doistrc"), "not json", "utf8");
		expect(detectTrackerSelection(dir.path)).toBe("neither");
	});

	it("reports the repo's own markers, not the process cwd's", () => {
		using dir = tempRepo();
		writeRc(dir.path, [{ id: "p1", label: "Test" }]);
		// A sibling repo with a scratch dir must not flip this repo's result.
		const sibling = tempRepo();
		mkdirSync(join(sibling.path, ".scratch"));
		expect(detectTrackerSelection(dir.path)).toBe("todoist");
		expect(detectTrackerSelection(sibling.path)).toBe("local");
	});
});
