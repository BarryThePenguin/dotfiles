import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMarkdownTracker } from "./local-tracker.ts";
import { resolveWayfinderTicket } from "./operations.ts";

let root: string;
let tracker: LocalMarkdownTracker;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "wayfinder-operation-"));
	tracker = new LocalMarkdownTracker(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("resolveWayfinderTicket", () => {
	it("resolves the first frontier ticket and records the decision", async () => {
		const map = await tracker.createMap({
			title: "Map",
			destination: "Destination is clear.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose path",
			type: "grilling",
			question: "Which path should we take?",
		});

		const result = await resolveWayfinderTicket(
			tracker,
			{
				mapId: map.id,
				claimant: "pi",
				resolution: "Resolved: take the simplest path.",
				decisionGist: "Take the simplest path.",
			},
			{ defaultClaimant: "fallback" },
		);

		expect(result.resolvedTicket).toMatchObject({
			id: ticket.id,
			status: "closed",
			claimedBy: "pi",
			comments: ["Resolved: take the simplest path."],
		});
		expect(result.map.decisionsSoFar).toEqual([
			{
				title: "Choose path",
				url: ticket.url,
				gist: "Take the simplest path.",
			},
		]);
	});

	it("creates follow-up tickets", async () => {
		const map = await tracker.createMap({
			title: "Map",
			destination: "Destination is clear.",
		});
		await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose path",
			type: "grilling",
			question: "Which path should we take?",
		});

		const result = await resolveWayfinderTicket(tracker, {
			mapId: map.id,
			resolution: "Resolved.",
			decisionGist: "Resolved.",
			newTickets: [
				{
					title: "Research next thing",
					type: "research",
					question: "What facts are needed next?",
				},
			],
		});

		expect(result.createdTickets).toHaveLength(1);
		expect(result.createdTickets[0]).toMatchObject({
			title: "Research next thing",
			type: "research",
			status: "open",
		});
	});
});
