import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectTrackerSelection,
	findDoistRc,
	localTrackerRoot,
	selectedTrackerMode,
} from "./tracker.ts";

// ---------------------------------------------------------------------------
// Tracker selection
// ---------------------------------------------------------------------------

const ENV_KEYS = ["WAYFINDER_TRACKER"] as const;
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
		mkdirSync(join(dir, ".scratch"));
		process.env["WAYFINDER_TRACKER"] = "todoist";

		expect(detectTrackerSelection(dir)).toEqual({
			mode: "todoist",
			source: "env",
		});
	});

	it("uses an existing local tracker directory", () => {
		const dir = tempDir();
		mkdirSync(join(dir, ".scratch"));

		expect(detectTrackerSelection(dir)).toEqual({
			mode: "local",
			source: "existing-local",
			path: join(dir, ".scratch"),
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

	it("uses .scratch for the local tracker path", () => {
		const dir = tempDir();
		mkdirSync(join(dir, ".scratch"));

		expect(localTrackerRoot(dir)).toBe(join(dir, ".scratch"));
		expect(detectTrackerSelection(dir)).toMatchObject({
			mode: "local",
			source: "existing-local",
			path: join(dir, ".scratch"),
		});
	});
});

