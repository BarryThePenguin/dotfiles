import { describe, expect, it } from "vitest";
import {
	parseTicketBody,
	renderTicketBody,
	setClaimedBy,
} from "./ticket-body.ts";

describe("Wayfinder ticket body", () => {
	it("renders and parses a ticket question with a readable blocked-by list", () => {
		const body = renderTicketBody({
			question: "Which tracker should own durable Wayfinder state?",
			blockers: [
				{ id: "ticket-1", title: "Ticket 1", url: "https://example.com/ticket-1" },
				{ id: "ticket-2", title: "Ticket 2", url: "https://example.com/ticket-2" },
			],
			claimedBy: "agent-1",
		});

		expect(body).toContain("## Question");
		expect(body).toContain("Which tracker should own durable Wayfinder state?");
		expect(body).toContain("[Ticket 1](https://example.com/ticket-1)");
		expect(body).toContain("[Ticket 2](https://example.com/ticket-2)");
		expect(body).not.toContain("wayfinder:blocked-by");
		expect(body).not.toContain("wayfinder:map");
		expect(body).not.toContain("wayfinder:claimed-by");

		expect(parseTicketBody(body)).toEqual({
			question: "Which tracker should own durable Wayfinder state?",
			blockerIds: ["ticket-1", "ticket-2"],
			claimedBy: "agent-1",
		});
	});

	it("round-trips Markdown blocks in questions", () => {
		const body = renderTicketBody({
			question: [
				"Which path should we take?",
				"",
				"- simplest",
				"- safest",
				"",
				"```ts",
				"const choice = 'simple';",
				"```",
			].join("\n"),
			blockers: [],
		});

		expect(body).toContain("- simplest");
		expect(body).toContain("```ts");
		expect(parseTicketBody(body).question).toBe(
			"Which path should we take?\n\n- simplest\n- safest\n\n```ts\nconst choice = 'simple';\n```",
		);
	});

	it("parses empty optional metadata as absent", () => {
		const body = `## Question

Choose a first implementation slice.
`;

		expect(parseTicketBody(body)).toEqual({
			question: "Choose a first implementation slice.",
			blockerIds: [],
		});
	});

	it("dedupes repeated blocker links", () => {
		const body = `## Question

Continue the work.

## Blocked by

- [Ticket 1](https://example.com/ticket-1)
- [Ticket 1 again](https://example.com/ticket-1)
`;

		expect(parseTicketBody(body).blockerIds).toEqual(["ticket-1"]);
	});

	it("round-trips a blocker whose title contains a comma", () => {
		const body = renderTicketBody({
			question: "Continue the work.",
			blockers: [
				{
					id: "ticket-1",
					title: "Pick A, B, or C",
					url: "https://example.com/ticket-1",
				},
			],
		});

		const parsed = parseTicketBody(body);
		expect(parsed.blockerIds).toEqual(["ticket-1"]);
	});

	it("picks up links in non-list sections", () => {
		const body = `## Question

Continue the work.

## Blocked by

See [Ticket 1](https://example.com/ticket-1) and [Ticket 2](https://example.com/ticket-2).
`;

		expect(parseTicketBody(body).blockerIds).toEqual(["ticket-1", "ticket-2"]);
	});

	it("renders the claimed-by field as a header line above the Question section", () => {
		const body = renderTicketBody({
			question: "Choose a tracker.",
			blockers: [],
			claimedBy: "agent-1",
		});

		expect(body).toContain("Claimed by: agent-1");
		// The "Claimed by" line must come before "## Question" so the section
		// range logic doesn't sweep it into the question.
		const claimedIndex = body.indexOf("Claimed by: agent-1");
		const questionIndex = body.indexOf("## Question");
		expect(claimedIndex).toBeGreaterThan(-1);
		expect(questionIndex).toBeGreaterThan(claimedIndex);
	});

	it("setClaimedBy writes the header line", () => {
		const before = `## Question

Continue the work.
`;

		const after = setClaimedBy(before, "new-agent");

		expect(after).toContain("Claimed by: new-agent");
	});

	it("setClaimedBy with undefined removes the header line", () => {
		const before = `Claimed by: old-agent

## Question

Continue the work.
`;

		const after = setClaimedBy(before, undefined);

		expect(after).not.toContain("Claimed by:");
	});
});
