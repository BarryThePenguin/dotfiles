import type {
	BlockedFrontierTicket,
	FrontierInspection,
	WayfinderTrackerTicket,
} from "./tracker.ts";

type TicketReader = {
	getTicket(id: string): Promise<WayfinderTrackerTicket>;
};

type BlockingDependencyWriter = TicketReader & {
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket>;
};

export function canClaimTicket(ticket: WayfinderTrackerTicket): boolean {
	return ticket.status === "open" && !ticket.claimedBy;
}

/**
 * Partition a Wayfinder map's child tickets into frontier, blocked, and
 * claimed. Pure over a single list: blocker statuses are derived from the
 * same tickets, which is sound because blockers are always siblings of the
 * same map (enforced at the write seam). A blocker id not in the list is
 * treated as blocking.
 */
export function partitionOpenTickets(
	tickets: readonly WayfinderTrackerTicket[],
): FrontierInspection {
	const statuses = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
	const frontier: WayfinderTrackerTicket[] = [];
	const blocked: BlockedFrontierTicket[] = [];
	const claimed: WayfinderTrackerTicket[] = [];

	for (const ticket of tickets) {
		if (ticket.status !== "open") {
			continue;
		}
		if (ticket.claimedBy) {
			claimed.push(ticket);
			continue;
		}
		const openBlockers = ticket.blockerIds.filter(
			(blockerId) => statuses.get(blockerId) !== "closed",
		);
		if (openBlockers.length > 0) {
			blocked.push({ ticket, blockers: openBlockers });
		} else {
			frontier.push(ticket);
		}
	}

	return { frontier, blocked, claimed };
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
