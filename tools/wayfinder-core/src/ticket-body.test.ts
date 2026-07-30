import { describe, expect, it } from "vitest";
import { parseTicketBody, renderTicketBody } from "./ticket-body.ts";

describe("Wayfinder ticket body", () => {
	it("renders and parses a ticket question with a readable blocked-by list", () => {
		const body = renderTicketBody({
			question: "Which tracker should own durable Wayfinder state?",
			mapId: "map-123",
			blockerIds: ["ticket-1", "ticket-2"],
			claimedBy: "agent-1",
		});

		expect(body).toContain("## Question");
		expect(body).toContain("Which tracker should own durable Wayfinder state?");
		expect(body).toContain("## Blocked by:\n\n- ticket-1\n- ticket-2");
		expect(body).not.toContain("wayfinder:blocked-by");

		expect(parseTicketBody(body)).toEqual({
			question: "Which tracker should own durable Wayfinder state?",
			mapId: "map-123",
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
			blockerIds: [],
		});

		expect(body).toContain("- simplest");
		expect(body).toContain("```ts");
		expect(parseTicketBody(body).question).toBe(
			"Which path should we take?\n\n- simplest\n- safest\n\n```ts\nconst choice = 'simple';\n```",
		);
	});

	it("parses legacy blocked-by metadata for existing tickets", () => {
		const body = `<!-- wayfinder:blocked-by ticket-1 -->
<!-- wayfinder:blocked-by ticket-2 -->
## Question

Choose a first implementation slice.
`;

		expect(parseTicketBody(body)).toMatchObject({
			blockerIds: ["ticket-1", "ticket-2"],
		});
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
});
