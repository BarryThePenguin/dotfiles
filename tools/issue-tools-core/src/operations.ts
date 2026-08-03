import type {
	WayfinderTracker,
	WayfinderTrackerTicket,
} from "./tracker.ts";

export type BlockedFrontierTicket = {
	ticket: WayfinderTrackerTicket;
	blockers: string[];
};

export type FrontierInspection = {
	frontier: WayfinderTrackerTicket[];
	blocked: BlockedFrontierTicket[];
	claimed: WayfinderTrackerTicket[];
};

export async function inspectFrontier(
	tracker: WayfinderTracker,
	mapId: string,
): Promise<FrontierInspection> {
	const tickets = await tracker.listChildTickets(mapId);
	const frontier = await tracker.listFrontierTickets(mapId);
	const frontierIds = new Set(frontier.map((ticket) => ticket.id));
	const blocked: BlockedFrontierTicket[] = [];
	const claimed: WayfinderTrackerTicket[] = [];

	for (const ticket of tickets) {
		if (ticket.status !== "open" || frontierIds.has(ticket.id)) {
			continue;
		}
		if (ticket.claimedBy) {
			claimed.push(ticket);
			continue;
		}
		const openBlockers: string[] = [];
		for (const blockerId of ticket.blockerIds) {
			const blocker = await tracker.getTicket(blockerId);
			if (blocker.status !== "closed") {
				openBlockers.push(blockerId);
			}
		}
		if (openBlockers.length > 0) {
			blocked.push({ ticket, blockers: openBlockers });
		}
	}

	return { frontier, blocked, claimed };
}
