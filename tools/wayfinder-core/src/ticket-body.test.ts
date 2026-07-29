import { describe, expect, it } from "vitest";
import { parseTicketBody, renderTicketBody } from "./ticket-body.ts";

describe("Wayfinder ticket body", () => {
	it("renders and parses a ticket question with Wayfinder metadata", () => {
		const body = renderTicketBody({
			question: "Which tracker should own durable Wayfinder state?",
			mapId: "map-123",
			blockerIds: ["ticket-1", "ticket-2"],
			claimedBy: "agent-1",
		});

		expect(body).toContain("## Question");
		expect(body).toContain("Which tracker should own durable Wayfinder state?");

		expect(parseTicketBody(body)).toEqual({
			question: "Which tracker should own durable Wayfinder state?",
			mapId: "map-123",
			blockerIds: ["ticket-1", "ticket-2"],
			claimedBy: "agent-1",
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
