import type { WayfinderTrackerTicket } from "./tracker.ts";

type TicketReader = {
	getTicket(id: string): Promise<WayfinderTrackerTicket>;
};

type ChildTicketReader = TicketReader & {
	listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]>;
};

type BlockingDependencyWriter = TicketReader & {
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket>;
};

export async function listFrontierTickets(
	tracker: ChildTicketReader,
	mapId: string,
): Promise<WayfinderTrackerTicket[]> {
	const tickets = await tracker.listChildTickets(mapId);
	const frontier: WayfinderTrackerTicket[] = [];

	for (const ticket of tickets) {
		if (ticket.status !== "open" || ticket.claimedBy) {
			continue;
		}

		const blockers = await Promise.all(
			ticket.blockerIds.map((blockerId) => tracker.getTicket(blockerId)),
		);
		if (blockers.every((blocker) => blocker.status === "closed")) {
			frontier.push(ticket);
		}
	}

	return frontier;
}

export function canClaimTicket(ticket: WayfinderTrackerTicket): boolean {
	return ticket.status === "open" && !ticket.claimedBy;
}

export async function addBlockingDependency(
	tracker: BlockingDependencyWriter,
	id: string,
	blockerId: string,
): Promise<WayfinderTrackerTicket> {
	const ticket = await tracker.getTicket(id);
	return tracker.setBlockingDependencies(id, [
		...new Set([...ticket.blockerIds, blockerId]),
	]);
}
