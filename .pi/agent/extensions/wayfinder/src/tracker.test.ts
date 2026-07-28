import { describe, expect, it } from "vitest";
import { parseBlockedBy, setBlockedBy } from "./tracker.ts";

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
