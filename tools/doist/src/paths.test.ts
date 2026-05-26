import { expect, it, vi } from "vitest";
import { findDoistDir } from "./paths.ts";

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

it("returns the start directory when no .doistrc found", () => {
	const exists = vi.fn().mockReturnValue(false);
	const start = "/tmp/nothing/here";
	const dir = findDoistDir(start, { exists });
	expect(dir).toBe(start);
});
