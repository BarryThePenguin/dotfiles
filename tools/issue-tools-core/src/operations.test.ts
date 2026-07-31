import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMarkdownTracker } from "./local-tracker.ts";
import {
	inspectFrontier,
	resolveTicket,
	resolveWayfinderTicket,
} from "./operations.ts";

let root: string;
let tracker: LocalMarkdownTracker;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "wayfinder-operation-"));
	tracker = new LocalMarkdownTracker(root);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("inspectFrontier", () => {
	it("classifies frontier, blocked, and claimed open tickets", async () => {
		const map = await tracker.createMap({
			title: "Map",
			destination: "Destination is clear.",
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
			type: "task",
			question: "What waits?",
			blockerIds: [blocker.id],
		});
		const claimed = await tracker.createChildTicket({
			mapId: map.id,
			title: "Claimed decision",
			type: "grilling",
			question: "Who owns this?",
		});
		await tracker.claimTicketIfUnclaimed(claimed.id, "agent-1");

		const result = await inspectFrontier(tracker, map.id);

		expect(result.frontier.map((ticket) => ticket.id)).toEqual([blocker.id]);
		expect(result.blocked).toEqual([{ ticket: blocked, blockers: [blocker.id] }]);
		expect(result.claimed.map((ticket) => ticket.id)).toEqual([claimed.id]);
	});
});

describe("resolveTicket", () => {
	it("resolves, records a decision, and reports newly unblocked tickets", async () => {
		const map = await tracker.createMap({
			title: "Map",
			destination: "Destination is clear.",
		});
		const blocker = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose path",
			type: "grilling",
			question: "Which path should we take?",
		});
		const blocked = await tracker.createChildTicket({
			mapId: map.id,
			title: "Follow up",
			type: "task",
			question: "What follows?",
			blockerIds: [blocker.id],
		});

		const result = await resolveTicket(tracker, {
			ticketId: blocker.id,
			resolution: "Resolved.",
			gist: "Take the simplest path.",
		});

		expect(result.resolvedTicket).toMatchObject({
			id: blocker.id,
			status: "closed",
			answer: "Resolved.",
		});
		expect(result.map?.decisionsSoFar).toEqual([
			{
				title: "Choose path",
				url: blocker.url,
				gist: "Take the simplest path.",
			},
		]);
		expect(result.unblocked).toEqual([blocked.id]);
		expect(result.usedFallback).toBe(false);
	});
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
			answer: "Resolved: take the simplest path.",
			comments: [],
		});
		expect(result.map?.decisionsSoFar).toEqual([
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
