import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectTrackerSelection,
	findDoistRc,
	localTrackerRoot,
	parseBlockedBy,
	selectedTrackerMode,
	setBlockedBy,
} from "./tracker.ts";

// ---------------------------------------------------------------------------
// Tracker selection
// ---------------------------------------------------------------------------

const ENV_KEYS = ["WAYFINDER_TRACKER", "WAYFINDER_ROOT"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDirs: string[] = [];

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "wayfinder-tracker-"));
	tempDirs.push(dir);
	return dir;
}

beforeEach(() => {
	originalEnv = Object.fromEntries(
		ENV_KEYS.map((key) => [key, process.env[key]]),
	);
	for (const key of ENV_KEYS) {
		Reflect.deleteProperty(process.env, key);
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) {
			Reflect.deleteProperty(process.env, key);
		} else {
			process.env[key] = value;
		}
	}
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
});

describe("detectTrackerSelection", () => {
	it("uses explicit WAYFINDER_TRACKER first", () => {
		const dir = tempDir();
		mkdirSync(join(dir, ".wayfinder"));
		process.env["WAYFINDER_TRACKER"] = "todoist";

		expect(detectTrackerSelection(dir)).toEqual({
			mode: "todoist",
			source: "env",
		});
	});

	it("uses an existing local tracker directory", () => {
		const dir = tempDir();
		mkdirSync(join(dir, ".wayfinder"));

		expect(detectTrackerSelection(dir)).toEqual({
			mode: "local",
			source: "existing-local",
			path: join(dir, ".wayfinder"),
		});
	});

	it("uses an existing .doistrc when no local tracker exists", () => {
		const dir = tempDir();
		writeFileSync(join(dir, ".doistrc"), "{}\n");

		expect(detectTrackerSelection(dir)).toEqual({
			mode: "todoist",
			source: "existing-doist",
			path: join(dir, ".doistrc"),
		});
	});

	it("walks up to find .doistrc before the git root", () => {
		const dir = tempDir();
		const child = join(dir, "packages", "app");
		mkdirSync(child, { recursive: true });
		writeFileSync(join(dir, ".doistrc"), "{}\n");

		expect(findDoistRc(child)).toBe(join(dir, ".doistrc"));
	});

	it("asks for a preference when neither tracker exists", () => {
		const dir = tempDir();
		expect(detectTrackerSelection(dir)).toEqual({
			mode: null,
			source: "needs-preference",
		});
		expect(selectedTrackerMode(dir)).toBe("local");
	});

	it("uses WAYFINDER_ROOT for the local tracker path", () => {
		const dir = tempDir();
		process.env["WAYFINDER_ROOT"] = ".wf";
		mkdirSync(join(dir, ".wf"));

		expect(localTrackerRoot(dir)).toBe(join(dir, ".wf"));
		expect(detectTrackerSelection(dir)).toMatchObject({
			mode: "local",
			source: "existing-local",
			path: join(dir, ".wf"),
		});
	});
});

// ---------------------------------------------------------------------------
// Blocking convention
// ---------------------------------------------------------------------------

describe("parseBlockedBy", () => {
	it("extracts task IDs from blocking annotation", () => {
		const desc = `<!-- wayfinder:blocked-by: abc123, def456 -->
Some description here.`;

		expect(parseBlockedBy(desc)).toEqual(["abc123", "def456"]);
	});

	it("returns empty array when no annotation", () => {
		expect(parseBlockedBy("Just a description")).toEqual([]);
	});

	it("handles single blocker", () => {
		const desc = `<!-- wayfinder:blocked-by: only-one -->`;
		expect(parseBlockedBy(desc)).toEqual(["only-one"]);
	});

	it("handles annotation with extra whitespace", () => {
		const desc = `<!--  wayfinder:blocked-by:   a ,  b  -->`;
		expect(parseBlockedBy(desc)).toEqual(["a", "b"]);
	});
});

describe("setBlockedBy", () => {
	it("adds blocking annotation to empty description", () => {
		const result = setBlockedBy("", ["abc", "def"]);
		expect(result).toContain("<!-- wayfinder:blocked-by: abc, def -->");
	});

	it("replaces existing annotation", () => {
		const desc = `<!-- wayfinder:blocked-by: old-id -->
Keep this text.`;

		const result = setBlockedBy(desc, ["new-id"]);
		expect(result).toContain("<!-- wayfinder:blocked-by: new-id -->");
		expect(result).toContain("Keep this text.");
		expect(result).not.toContain("old-id");
	});

	it("clears blocking when empty array", () => {
		const desc = `<!-- wayfinder:blocked-by: some-id -->
Keep this.`;

		const result = setBlockedBy(desc, []);
		expect(result).not.toContain("wayfinder:blocked-by");
		expect(result).toContain("Keep this.");
	});

	it("preserves description without annotation", () => {
		const desc = "Just a plain description.";
		const result = setBlockedBy(desc, ["id1"]);
		expect(result).toContain("Just a plain description.");
		expect(result).toContain("<!-- wayfinder:blocked-by: id1 -->");
	});
});
