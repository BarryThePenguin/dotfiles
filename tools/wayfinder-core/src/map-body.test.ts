import { describe, expect, it } from "vitest";
import {
	appendDecision,
	appendOutOfScope,
	parseMapBody,
	renderMapBody,
} from "./map-body.ts";

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

	it("appends a decision without removing existing map sections", () => {
		const body = renderMapBody({
			destination: "Find the way.",
			notes: "Planning only.",
			decisionsSoFar: [],
			notYetSpecified: ["Future question."],
			outOfScope: [],
		});

		const updated = appendDecision(body, {
			title: "Choose tracker",
			url: "todoist://task/1",
			gist: "Todoist owns durable state.",
		});

		const parsed = parseMapBody(updated);
		expect(parsed.destination).toBe("Find the way.");
		expect(parsed.notYetSpecified).toEqual(["Future question."]);
		expect(parsed.decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: "todoist://task/1",
				gist: "Todoist owns durable state.",
			},
		]);
	});

	it("appends out-of-scope entries", () => {
		const body = renderMapBody({
			destination: "Find the way.",
			notes: "Planning only.",
			decisionsSoFar: [],
			notYetSpecified: [],
			outOfScope: [],
		});

		const updated = appendOutOfScope(body, {
			text: "Linear backend",
			reason: "Todoist is first.",
		});

		expect(parseMapBody(updated).outOfScope).toEqual([
			{ text: "Linear backend", reason: "Todoist is first." },
		]);
	});
});
