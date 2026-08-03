import { describe, expect, it } from "vitest";
import type { WayfinderTrackerTicket } from "./tracker.ts";
import { partitionOpenTickets } from "./tracker-operations.ts";

function ticket(
	overrides: Partial<WayfinderTrackerTicket>,
): WayfinderTrackerTicket {
	return {
		id: "map/01",
		mapId: "map",
		title: "Ticket",
		type: "task",
		question: "Question",
		blockerIds: [],
		url: "issues/01.md",
		status: "open",
		comments: [],
		...overrides,
	};
}

describe("partitionOpenTickets", () => {
	it("partitions open tickets into frontier, blocked, and claimed", () => {
		const result = partitionOpenTickets([
			ticket({ id: "map/01-frontier" }),
			ticket({ id: "map/02-blocked", blockerIds: ["map/01-blocker"] }),
			ticket({ id: "map/01-blocker" }),
			ticket({ id: "map/03-claimed", claimedBy: "agent-1" }),
			ticket({ id: "map/04-closed", status: "closed" }),
		]);

		expect(result.frontier.map((t) => t.id)).toEqual([
			"map/01-frontier",
			"map/01-blocker",
		]);
		expect(result.blocked.map((entry) => entry.ticket.id)).toEqual([
			"map/02-blocked",
		]);
		expect(result.claimed.map((t) => t.id)).toEqual(["map/03-claimed"]);
	});

	it("reports only open blockers on a blocked ticket", () => {
		const result = partitionOpenTickets([
			ticket({ id: "map/01", blockerIds: ["map/02", "map/03"] }),
			ticket({ id: "map/02", status: "closed" }),
			ticket({ id: "map/03" }),
		]);

		expect(result.blocked).toEqual([
			{
				ticket: expect.objectContaining({ id: "map/01" }),
				blockers: ["map/03"],
			},
		]);
	});

	it("treats a blocker id not in the list as blocking", () => {
		const result = partitionOpenTickets([
			ticket({ id: "map/01", blockerIds: ["foreign/01"] }),
		]);

		expect(result.blocked).toEqual([
			{
				ticket: expect.objectContaining({ id: "map/01" }),
				blockers: ["foreign/01"],
			},
		]);
		expect(result.frontier).toEqual([]);
	});

	it("keeps a claimed ticket out of the frontier even with no open blockers", () => {
		const result = partitionOpenTickets([
			ticket({ id: "map/01", claimedBy: "agent-1" }),
		]);

		expect(result.claimed.map((t) => t.id)).toEqual(["map/01"]);
		expect(result.frontier).toEqual([]);
	});

	it("returns empty partitions for an empty list", () => {
		expect(partitionOpenTickets([])).toEqual({
			frontier: [],
			blocked: [],
			claimed: [],
		});
	});
});
