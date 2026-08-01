import { describe, expect, it } from "vitest";
import { mergeLabels } from "./labels.ts";

describe("mergeLabels", () => {
	it("returns the union of current and add, with remove subtracted", () => {
		expect(
			mergeLabels(["needs-triage", "bug"], ["home"], ["needs-triage"]),
		).toEqual(["bug", "home"]);
	});

	it("preserves the original order, appending additions", () => {
		expect(mergeLabels(["a", "b"], ["c", "d"], [])).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
	});

	it("makes remove win when the same label is in both add and remove", () => {
		expect(mergeLabels(["x"], ["x"], ["x"])).toEqual([]);
	});

	it("deduplicates when add overlaps with current", () => {
		expect(mergeLabels(["a", "b"], ["b", "c"], [])).toEqual(["a", "b", "c"]);
	});

	it("treats undefined add/remove as no-op", () => {
		expect(mergeLabels(["a", "b"], undefined, undefined)).toEqual(["a", "b"]);
	});
});
