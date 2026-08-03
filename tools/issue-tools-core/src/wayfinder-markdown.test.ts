import { describe, expect, it } from "vitest";
import { listItemTexts, markdownBlocks, stringifyChildren } from "./markdown.ts";
import { markdownDocument } from "./wayfinder-markdown.ts";

describe("Wayfinder Markdown document indexing", () => {
	it("indexes title, sections, and local headers during parsing", () => {
		const document = markdownDocument([
			"# 01 — Choose path",
			"",
			"Type: research",
			"Status: open",
			"Claimed by: pi",
			"",
			"## Question",
			"",
			"Which path?",
			"",
			"## Blocked by:",
			"",
			"- 01-blocker",
		].join("\n"));

		expect(document.index.title).toBe("01 — Choose path");
		expect(document.index.localHeaders).toEqual([
			{ name: "Type", value: "research" },
			{ name: "Status", value: "open" },
			{ name: "Claimed by", value: "pi" },
		]);
		expect(
			document.index.sections.map((section) => ({
				title: section.title,
				normalizedTitle: section.normalizedTitle,
				start: section.start,
				end: section.end,
			})),
		).toEqual([
			{
				title: "01 — Choose path",
				normalizedTitle: "01 — choose path",
				start: 0,
				end: 6,
			},
			{ title: "Question", normalizedTitle: "question", start: 2, end: 4 },
			{ title: "Blocked by:", normalizedTitle: "blocked by", start: 4, end: 6 },
		]);
	});
});

describe("Wayfinder Markdown document mutation", () => {
	it("setHeader adds, updates, and clears a header, keeping the index fresh", () => {
		const document = markdownDocument(
			[
				"# 01 — Choose path",
				"",
				"Type: research",
				"Status: open",
				"",
				"## Question",
				"",
				"Which path?",
			].join("\n"),
		);

		document.setHeader("Status", "claimed");
		expect(document.header("Status")).toBe("claimed");
		expect(document.index.localHeaders).toEqual([
			{ name: "Type", value: "research" },
			{ name: "Status", value: "claimed" },
		]);
		expect(document.section("Question").length).toBeGreaterThan(0);

		document.setHeader("Claimed by", "pi");
		expect(document.header("Claimed by")).toBe("pi");

		document.setHeader("Status", undefined);
		expect(document.header("Status")).toBeUndefined();
	});

	it("setSection replaces an existing section in place", () => {
		const document = markdownDocument(
			[
				"## Question",
				"",
				"old question",
				"",
				"## Blocked by:",
				"",
				"- 01-thing",
			].join("\n"),
		);

		document.setSection("Question", markdownBlocks("new question"));

		expect(stringifyChildren(document.section("Question"))).toBe("new question");
		expect(listItemTexts(document.section("Blocked by"))).toEqual(["01-thing"]);
	});

	it("setSection appends a new section when none exists", () => {
		const document = markdownDocument("## Question\n\nWhich path?\n");

		document.setSection("Answer", markdownBlocks("Because of the seam."));

		expect(stringifyChildren(document.section("Answer"))).toBe(
			"Because of the seam.",
		);
		expect(document.stringify()).toContain("## Answer");
	});

	it("removeSection removes a section and no-ops when it is missing", () => {
		const document = markdownDocument(
			["## Question", "", "Which path?", "", "## Answer", "", "Because."].join(
				"\n",
			),
		);

		document.removeSection("Answer");
		expect(document.section("Answer")).toEqual([]);
		expect(document.index.sections.map((s) => s.title)).not.toContain("Answer");

		// No-op, not a throw.
		document.removeSection("Nonexistent");
	});

	it("mutations survive a stringify round-trip", () => {
		const document = markdownDocument("## Question\n\nWhich path?\n");
		document.setHeader("Claimed by", "pi");
		document.setSection("Blocked by:", markdownBlocks("- 01-thing"));

		const reparsed = markdownDocument(document.stringify());
		expect(reparsed.header("Claimed by")).toBe("pi");
		expect(listItemTexts(reparsed.section("Blocked by"))).toEqual(["01-thing"]);
	});

	it("setSection and section respect an explicit depth", () => {
		const document = markdownDocument("## Question\n\nWhich path?\n");

		document.setSection("Nested", markdownBlocks("deep"), { depth: 3 });

		expect(stringifyChildren(document.section("Nested", { depth: 3 }))).toBe(
			"deep",
		);
		expect(document.section("Nested")).toEqual([]);
	});
});
