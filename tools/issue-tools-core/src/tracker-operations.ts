import type { WayfinderTrackerTicket } from "./tracker.ts";

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
