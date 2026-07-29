import { mkdtempDisposableSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalMarkdownTracker } from "./local-tracker.ts";
import { parseMapBody } from "./map-body.ts";
import { parseTicketBody } from "./ticket-body.ts";

function setupDir() {
	return mkdtempDisposableSync(join(tmpdir(), "wayfinder-local-tracker-"));
}

describe("LocalMarkdownTracker", () => {
	it("creates a map and ticket as Markdown files", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
			notes: "Use Todoist subtasks for tickets.",
			notYetSpecified: ["How to represent dependencies visually."],
		});

		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose the first implementation slice",
			type: "grilling",
			question: "What is the smallest useful implementation slice?",
		});

		expect(map).toMatchObject({
			title: "Plan Todoist Wayfinder",
			url: `local-wayfinder://map/${map.id}`,
		});
		expect(map.id).toMatch(/^map_[0-9a-f-]+$/);
		expect(ticket).toMatchObject({
			mapId: map.id,
			title: "Choose the first implementation slice",
			type: "grilling",
			url: `local-wayfinder://ticket/${ticket.id}`,
			status: "open",
		});
		expect(ticket.id).toMatch(/^ticket_[0-9a-f-]+$/);

		const mapBody = await readFile(
			join(rootDir.path, "maps", `${map.id}.md`),
			"utf8",
		);
		expect(parseMapBody(mapBody).destination).toBe(
			"A Todoist-backed Wayfinder MVP exists.",
		);

		const ticketBody = await readFile(
			join(rootDir.path, "tickets", `${ticket.id}.md`),
			"utf8",
		);
		expect(parseTicketBody(ticketBody)).toEqual({
			question: "What is the smallest useful implementation slice?",
			mapId: map.id,
			blockerIds: [],
		});
	});

	it("lists only incomplete, unclaimed, unblocked child tickets as frontier", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
		});
		const blocker = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocking decision",
			type: "research",
			question: "What blocks the follow-up?",
		});
		const blocked = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocked decision",
			type: "grilling",
			question: "What should happen after the blocker?",
			blockerIds: [blocker.id],
		});
		const claimed = await tracker.createChildTicket({
			mapId: map.id,
			title: "Already claimed decision",
			type: "task",
			question: "Who owns this?",
		});
		await tracker.claimTicketIfUnclaimed(claimed.id, "agent-1");

		expect(
			(await tracker.listFrontierTickets(map.id)).map((ticket) => ticket.id),
		).toEqual([blocker.id]);

		await tracker.closeTicket(blocker.id);

		expect(
			(await tracker.listFrontierTickets(map.id)).map((ticket) => ticket.id),
		).toEqual([blocked.id]);
	});

	it("claims, comments on, records, and closes a ticket", async () => {
		using rootDir = setupDir();
		const tracker = new LocalMarkdownTracker(rootDir.path);
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed Wayfinder MVP exists.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose tracker",
			type: "grilling",
			question: "Which tracker owns durable state?",
		});

		const claim = await tracker.claimTicketIfUnclaimed(ticket.id, "agent-1");
		expect(claim.claimed).toBe(true);
		expect(claim.ticket.claimedBy).toBe("agent-1");

		const secondClaim = await tracker.claimTicketIfUnclaimed(
			ticket.id,
			"agent-2",
		);
		expect(secondClaim.claimed).toBe(false);
		expect(secondClaim.ticket.claimedBy).toBe("agent-1");

		await tracker.postComment(ticket.id, "Resolution: use Todoist.");
		await tracker.recordDecision(map.id, {
			title: ticket.title,
			url: ticket.url,
			gist: "Todoist owns durable state.",
		});
		await tracker.closeTicket(ticket.id);

		expect((await tracker.getTicket(ticket.id)).status).toBe("closed");
		expect((await tracker.getTicket(ticket.id)).comments).toEqual([
			"Resolution: use Todoist.",
		]);
		expect((await tracker.getMap(map.id)).decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		]);
	});
});
