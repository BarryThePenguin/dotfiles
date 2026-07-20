import { expect, it } from "vitest";
import { findDoistDir, findPaths } from "./paths.ts";

it("finds .doistrc in the given directory", () => {
	const exists = (path: string) => path === "/tmp/project/.doistrc";
	const start = "/tmp/project";
	const dir = findDoistDir(start, { exists });
	expect(dir).toBe(start);
});

it("walks up to find .doistrc in a parent directory", () => {
	const exists = (path: string) => path === "/tmp/project/.doistrc";
	const start = "/tmp/project/child";
	const dir = findDoistDir(start, { exists });
	expect(dir).toBe("/tmp/project");
});

it("returns null when no .doistrc is found in the git repository", () => {
	const exists = (path: string) => path === "/tmp/project/.git";
	const start = "/tmp/project/child";
	const dir = findDoistDir(start, { exists });
	expect(dir).toBeNull();
});

it("does not search past the git repository root", () => {
	const exists = (path: string) =>
		path === "/tmp/.doistrc" || path === "/tmp/project/.git";
	const start = "/tmp/project/child";
	const dir = findDoistDir(start, { exists });
	expect(dir).toBeNull();
});

it("returns null when no .doistrc is found", () => {
	const exists = (path: string) => path === "/tmp/project/.git";
	const paths = findPaths("/tmp/project/child", { exists });
	expect(paths).toBeNull();
});

it("co-locates the db with the .doistrc file when present", () => {
	const exists = (path: string) =>
		path === "/tmp/project/.git" || path === "/tmp/project/.doistrc";
	const paths = findPaths("/tmp/project/child", { exists });
	expect(paths).not.toBeNull();
	expect(paths?.rcPath).toBe("/tmp/project/.doistrc");
	expect(paths?.dbPath).toBe("/tmp/project/todoist.db");
});
