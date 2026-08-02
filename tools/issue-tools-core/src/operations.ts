import {
	ClosedTicketWithoutResolutionError,
	type WayfinderTracker,
	type WayfinderTrackerMap,
	type WayfinderTrackerTicket,
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

export type ResolveOutcome = "complete" | "partial" | "terminal";

export type ResolveTicketInput = {
	ticketId: string;
	mapId: string;
	resolution: string;
	gist: string;
};

export type ResolveTicketResult = {
	outcome: ResolveOutcome;
	resolvedTicket: WayfinderTrackerTicket;
	map?: WayfinderTrackerMap;
	mapId: string;
	unblocked: string[];
	error?: string;
	resolutionPosted: boolean;
	decisionRecorded: boolean;
};

async function findNewlyUnblocked(
	tracker: WayfinderTracker,
	mapId: string,
	resolvedTicketId: string,
): Promise<string[]> {
	const siblings = await tracker.listChildTickets(mapId);
	const candidates = siblings.filter(
		(sibling) =>
			sibling.status === "open" &&
			sibling.blockerIds.includes(resolvedTicketId),
	);
	const newlyUnblocked: string[] = [];

	for (const candidate of candidates) {
		const blockers = await Promise.all(
			candidate.blockerIds.map((blockerId) => tracker.getTicket(blockerId)),
		);
		if (blockers.every((blocker) => blocker.status === "closed")) {
			newlyUnblocked.push(candidate.id);
		}
	}

	return newlyUnblocked;
}

export async function resolveTicket(
	tracker: WayfinderTracker,
	input: ResolveTicketInput,
): Promise<ResolveTicketResult> {
	const ticket = await tracker.getTicket(input.ticketId);
	if (!ticket.mapId) {
		throw new Error(`Ticket ${input.ticketId} has no map identity.`);
	}
	if (ticket.mapId !== input.mapId) {
		throw new Error(
			`Ticket ${input.ticketId} has map identity ${ticket.mapId}, not ${input.mapId}.`,
		);
	}

	// Validate the map before the ticket adapter is allowed to mutate anything.
	await tracker.getMap(input.mapId);

	let resolvedTicket: WayfinderTrackerTicket;
	try {
		resolvedTicket = await tracker.resolveTicket(
			input.ticketId,
			input.resolution,
		);
	} catch (error) {
		if (!(error instanceof ClosedTicketWithoutResolutionError)) {
			throw error;
		}
		return {
			outcome: "terminal",
			resolvedTicket: ticket,
			mapId: input.mapId,
			unblocked: [],
			error: error.message,
			resolutionPosted: false,
			decisionRecorded: false,
		};
	}

	const unblocked = await findNewlyUnblocked(
		tracker,
		input.mapId,
		input.ticketId,
	);

	try {
		const map = await tracker.recordDecision(input.mapId, {
			title: ticket.title,
			url: ticket.url,
			gist: input.gist,
		});
		return {
			outcome: "complete",
			resolvedTicket,
			map,
			mapId: input.mapId,
			unblocked,
			resolutionPosted: true,
			decisionRecorded: true,
		};
	} catch (error) {
		return {
			outcome: "partial",
			resolvedTicket,
			mapId: input.mapId,
			unblocked,
			error: error instanceof Error ? error.message : String(error),
			resolutionPosted: true,
			decisionRecorded: false,
		};
	}
}
