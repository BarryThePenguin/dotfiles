import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMarkdownPersistenceAdapter } from "./local-markdown-adapter.ts";
import { createTrackerModules } from "./modules.ts";
import { inspectFrontier, resolveTicket } from "./operations.ts";

let root: string;
let tracker: ReturnType<typeof createTrackerModules>["wayfinder"];

class MapWriteFailingAdapter extends LocalMarkdownPersistenceAdapter {
	override writeMapDecisions(): Promise<never> {
		return Promise.reject(new Error("map write failed"));
	}
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "wayfinder-operation-"));
	tracker = createTrackerModules(
		new LocalMarkdownPersistenceAdapter(root),
	).wayfinder;
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
			mapId: map.id,
			resolution: "Resolved.",
			gist: "Take the simplest path.",
		});

		expect(result.resolvedTicket).toMatchObject({
			id: blocker.id,
			status: "closed",
			comments: ["Resolved."],
		});
		expect(result.map?.decisionsSoFar).toEqual([
			{
				title: "Choose path",
				url: blocker.url,
				gist: "Take the simplest path.",
			},
		]);
		expect(result.unblocked).toEqual([blocked.id]);
		expect(result.outcome).toBe("complete");
		expect(result.decisionRecorded).toBe(true);
	});

	it("rejects a missing or mismatched map identity before resolving the ticket", async () => {
		const map = await tracker.createMap({
			title: "Map",
			destination: "Destination is clear.",
		});
		const otherMap = await tracker.createMap({
			title: "Other map",
			destination: "A different destination.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose path",
			type: "grilling",
			question: "Which path should we take?",
		});

		await expect(
			resolveTicket(tracker, {
				ticketId: ticket.id,
				mapId: otherMap.id,
				resolution: "Resolved.",
				gist: "Take the simplest path.",
			}),
		).rejects.toThrow(/map identity/i);

		expect((await tracker.getTicket(ticket.id)).status).toBe("open");
	});

	it("returns a retryable partial result when map recording fails", async () => {
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

		const failingTracker = createTrackerModules(
			new MapWriteFailingAdapter(root),
		).wayfinder;
		const result = await resolveTicket(failingTracker, {
			ticketId: blocker.id,
			mapId: map.id,
			resolution: "Resolved.",
			gist: "Take the simplest path.",
		});

		expect(result).toMatchObject({
			outcome: "partial",
			decisionRecorded: false,
			unblocked: [blocked.id],
			resolvedTicket: { status: "closed" },
		});
		expect(result.error).toContain("map write failed");
	});

	it("returns a terminal result for a closed ticket without a Resolution", async () => {
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
		await tracker.closeTicket(ticket.id);

		const result = await resolveTicket(tracker, {
			ticketId: ticket.id,
			mapId: map.id,
			resolution: "Too late.",
			gist: "Inspect the incomplete ticket.",
		});

		expect(result).toMatchObject({
			outcome: "terminal",
			decisionRecorded: false,
			resolutionPosted: false,
			resolvedTicket: { status: "closed" },
		});
		expect(result.error).toMatch(/closed without/i);
	});
});
