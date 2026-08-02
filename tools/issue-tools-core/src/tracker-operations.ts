import {
	appendDecision,
	replaceMapSection,
	type MapSectionKey,
} from "./map-body.ts";
import type { DecisionSummary } from "./schema.ts";
import type {
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";

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

type MapBodyAccessor = {
	readMapBody(mapId: string): Promise<string>;
	readMap(mapId: string): Promise<WayfinderTrackerMap>;
	writeMapBody(mapId: string, body: string): Promise<WayfinderTrackerMap>;
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

export async function recordDecision(
	accessor: MapBodyAccessor,
	mapId: string,
	decision: DecisionSummary,
): Promise<WayfinderTrackerMap> {
	const currentBody = await accessor.readMapBody(mapId);
	const nextBody = appendDecision(currentBody, decision);
	if (nextBody === currentBody) {
		return accessor.readMap(mapId);
	}

	return accessor.writeMapBody(mapId, nextBody);
}

export async function updateMapSection(
	accessor: MapBodyAccessor,
	mapId: string,
	section: MapSectionKey,
	content: string,
): Promise<WayfinderTrackerMap> {
	return accessor.writeMapBody(
		mapId,
		replaceMapSection(await accessor.readMapBody(mapId), section, content),
	);
}
