import { describe, expect, it } from "vitest";
import { parseMapBody, renderMapBody } from "./map-body.ts";

describe("Wayfinder map body", () => {
	it("renders and parses required map sections", () => {
		const body = renderMapBody({
			destination: "A tested Todoist-backed Wayfinder MVP exists.",
			notes: "Use Todoist as the tracker.",
			decisionsSoFar: [
				{
					title: "Choose tracker",
					url: "todoist://task/1",
					gist: "Todoist owns durable state.",
				},
			],
			notYetSpecified: ["How to visualize blocked tickets."],
			outOfScope: [
				{
					text: "GitHub tracker backend",
					reason: "Todoist is the MVP tracker.",
					url: "todoist://task/2",
				},
			],
		});

		expect(body).toContain("## Destination");
		expect(body).toContain("## Decisions so far");

		expect(parseMapBody(body)).toEqual({
			destination: "A tested Todoist-backed Wayfinder MVP exists.",
			notes: "Use Todoist as the tracker.",
			decisionsSoFar: [
				{
					title: "Choose tracker",
					url: "todoist://task/1",
					gist: "Todoist owns durable state.",
				},
			],
			notYetSpecified: ["How to visualize blocked tickets."],
			outOfScope: [
				{
					text: "GitHub tracker backend",
					reason: "Todoist is the MVP tracker.",
					url: "todoist://task/2",
				},
			],
		});
	});

	it("round-trips Markdown blocks in destination and notes", () => {
		const body = renderMapBody({
			destination: [
				"Ship the thing.",
				"",
				"- works locally",
				"- works in Todoist",
			].join("\n"),
			notes: [
				"Context.",
				"",
				"### Detail",
				"",
				"```ts",
				"const x = 1;",
				"```",
			].join("\n"),
			decisionsSoFar: [],
			notYetSpecified: [],
			outOfScope: [],
		});

		expect(body).toContain("- works locally");
		expect(body).toContain("### Detail");
		expect(body).toContain("```ts");
		expect(parseMapBody(body)).toMatchObject({
			destination: "Ship the thing.\n\n- works locally\n- works in Todoist",
			notes: "Context.\n\n### Detail\n\n```ts\nconst x = 1;\n```",
		});
	});

	it("keeps lower-depth subheadings inside their parent section", () => {
		const parsed = parseMapBody([
			"## Destination",
			"",
			"Ship the thing.",
			"",
			"## Notes",
			"",
			"Intro.",
			"",
			"### Detail",
			"",
			"More detail.",
			"",
			"## Decisions so far",
			"",
			"- [Choose tracker](todoist://task/1) — Todoist wins.",
		].join("\n"));

		expect(parsed.notes).toBe("Intro.\n\n### Detail\n\nMore detail.");
		expect(parsed.decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: "todoist://task/1",
				gist: "Todoist wins.",
			},
		]);
	});

	it("parses decision and out-of-scope list items after prose", () => {
		const parsed = parseMapBody([
			"## Destination",
			"",
			"Find the way.",
			"",
			"## Decisions so far",
			"",
			"Context before the list.",
			"",
			"- [Choose tracker](todoist://task/1) — Todoist owns state.",
			"",
			"## Out of scope",
			"",
			"Context before exclusions.",
			"",
			"- [Linear backend](todoist://task/2) — Todoist is first.",
			"",
			"More prose.",
			"",
			"- GitHub backend — Not needed yet.",
		].join("\n"));

		expect(parsed.decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: "todoist://task/1",
				gist: "Todoist owns state.",
			},
		]);
		expect(parsed.outOfScope).toEqual([
			{
				text: "Linear backend",
				reason: "Todoist is first.",
				url: "todoist://task/2",
			},
			{ text: "GitHub backend", reason: "Not needed yet." },
		]);
	});
});
