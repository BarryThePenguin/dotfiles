import { describe, expect, it } from "vitest";
import {
	applyRepoMarker,
	detectSetupMode,
	extensionToolCount,
	toolInventory,
} from "./setup-issue-tracker.ts";

describe("detectSetupMode", () => {
	const cwd = "/repo";
	it("returns 'local' when .scratch exists", () => {
		expect(
			detectSetupMode(cwd, { hasScratchDir: true, hasDoistrc: false }),
		).toBe("local");
	});

	it("returns 'todoist' when .doistrc exists", () => {
		expect(
			detectSetupMode(cwd, { hasScratchDir: false, hasDoistrc: true }),
		).toBe("todoist");
	});

	it("returns 'ambiguous' when both .scratch and .doistrc exist", () => {
		expect(
			detectSetupMode(cwd, { hasScratchDir: true, hasDoistrc: true }),
		).toBe("ambiguous");
	});

	it("returns 'ambiguous' when neither exists", () => {
		expect(
			detectSetupMode(cwd, { hasScratchDir: false, hasDoistrc: false }),
		).toBe("ambiguous");
	});
});

describe("applyRepoMarker", () => {
	it("sets repo: true on the given project, removing it from others", () => {
		const before = [
			{ id: "a", label: "A" },
			{ id: "b", label: "B", repo: true },
		];
		expect(applyRepoMarker(before, "a")).toEqual([
			{ id: "a", label: "A", repo: true },
			{ id: "b", label: "B" },
		]);
	});

	it("preserves order and other project fields", () => {
		const before = [
			{ id: "x", label: "X" },
			{ id: "y", label: "Y" },
			{ id: "z", label: "Z" },
		];
		expect(applyRepoMarker(before, "z")).toEqual([
			{ id: "x", label: "X" },
			{ id: "y", label: "Y" },
			{ id: "z", label: "Z", repo: true },
		]);
	});

	it("returns the same list when the marker is already on the right project", () => {
		const before = [
			{ id: "a", label: "A" },
			{ id: "b", label: "B", repo: true },
		];
		const after = applyRepoMarker(before, "b");
		// The entries are the same; no allocation needed.
		expect(after).toEqual(before);
	});
});

describe("toolInventory", () => {
	it("includes the Pi wayfinder tool names (not the internal core names)", () => {
		const inventory = toolInventory();
		const wayfinder = inventory
			.filter((entry) => entry.group === "wayfinder")
			.map((entry) => entry.name);
		expect(wayfinder).toContain("wayfinder_chart");
		expect(wayfinder).toContain("wayfinder_resolve");
		expect(wayfinder).toContain("wayfinder_list_frontier");
		expect(wayfinder).toContain("wayfinder_claim");
		expect(wayfinder).not.toContain("wayfinder_create_map");
	});

	it("includes the six issue tools in their registered names", () => {
		const inventory = toolInventory();
		const issue = inventory
			.filter((entry) => entry.group === "issue")
			.map((entry) => entry.name);
		expect(issue).toEqual([
			"issue_create",
			"issue_read",
			"issue_label",
			"issue_comment",
			"issue_close",
			"issue_list",
		]);
	});

	it("extensionToolCount matches the sum of wayfinder + issue tools", () => {
		expect(extensionToolCount()).toBe(toolInventory().length);
	});
});
