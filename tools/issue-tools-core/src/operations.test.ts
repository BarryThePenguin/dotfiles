import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMarkdownPersistenceAdapter } from "./local-markdown-adapter.ts";
import { createTrackerModules } from "./modules.ts";
import { inspectFrontier } from "./operations.ts";

let root: string;
let tracker: ReturnType<typeof createTrackerModules>["wayfinder"];

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
