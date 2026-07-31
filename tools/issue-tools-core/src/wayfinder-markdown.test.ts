import { describe, expect, it } from "vitest";
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
