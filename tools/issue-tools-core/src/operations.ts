import type { TicketType } from "./schema.ts";
import type {
	WayfinderTracker,
	WayfinderTrackerMap,
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

export type ResolveTicketInput = {
	ticketId: string;
	resolution: string;
	gist: string;
	mapId?: string;
};

export type ResolveTicketResult = {
	resolvedTicket: WayfinderTrackerTicket;
	map?: WayfinderTrackerMap;
	mapId?: string;
	unblocked: string[];
	usedFallback: boolean;
	resolutionPosted: true;
	decisionRecorded: boolean;
};

export async function resolveTicket(
	tracker: WayfinderTracker,
	input: ResolveTicketInput,
): Promise<ResolveTicketResult> {
	const ticket = await tracker.getTicket(input.ticketId);
	const mapId = ticket.mapId || input.mapId;
	const usedFallback = !ticket.mapId && !!mapId;

	await tracker.postComment(input.ticketId, input.resolution);
	const resolvedTicket = await tracker.closeTicket(input.ticketId);

	let map: WayfinderTrackerMap | undefined;
	let unblocked: string[] = [];
	if (mapId) {
		map = await tracker.recordDecision(mapId, {
			title: ticket.title,
			url: ticket.url,
			gist: input.gist,
		});
		const siblings = await tracker.listChildTickets(mapId);
		unblocked = siblings
			.filter((sibling) => {
				if (
					sibling.status !== "open" ||
					!sibling.blockerIds.includes(input.ticketId)
				) {
					return false;
				}
				const remaining = sibling.blockerIds.filter(
					(blockerId) => blockerId !== input.ticketId,
				);
				return remaining.length === 0;
			})
			.map((sibling) => sibling.id);
	}

	return {
		resolvedTicket,
		...(map ? { map } : {}),
		...(mapId ? { mapId } : {}),
		unblocked,
		usedFallback,
		resolutionPosted: true,
		decisionRecorded: Boolean(map),
	};
}

export type ResolveWayfinderTicketInput = {
	mapId: string;
	ticketId?: string;
	claimant?: string;
	resolution: string;
	decisionGist: string;
	newTickets?: Array<{
		title: string;
		type: TicketType;
		question: string;
		blockerIds?: string[];
	}>;
};

export type ResolveWayfinderTicketOptions = {
	defaultClaimant?: string;
};

export async function resolveWayfinderTicket(
	tracker: WayfinderTracker,
	input: ResolveWayfinderTicketInput,
	options: ResolveWayfinderTicketOptions = {},
) {
	const ticket = input.ticketId
		? await tracker.getTicket(input.ticketId)
		: (await tracker.listFrontierTickets(input.mapId))[0];

	if (!ticket) {
		throw new Error(`No frontier tickets found for map ${input.mapId}.`);
	}

	const claimant = input.claimant ?? options.defaultClaimant;
	if (claimant) {
		const claim = await tracker.claimTicketIfUnclaimed(ticket.id, claimant);
		if (!claim.claimed && claim.ticket.claimedBy !== claimant) {
			throw new Error(
				`Ticket ${ticket.id} is already claimed by ${claim.ticket.claimedBy ?? "another actor"}.`,
			);
		}
	}

	const resolved = await resolveTicket(tracker, {
		ticketId: ticket.id,
		mapId: input.mapId,
		resolution: input.resolution,
		gist: input.decisionGist,
	});

	const createdTickets = [];
	for (const newTicket of input.newTickets ?? []) {
		createdTickets.push(
			await tracker.createChildTicket({
				mapId: input.mapId,
				title: newTicket.title,
				type: newTicket.type,
				question: newTicket.question,
				...(newTicket.blockerIds !== undefined
					? { blockerIds: newTicket.blockerIds }
					: {}),
			}),
		);
	}

	return {
		map: resolved.map,
		resolvedTicket: resolved.resolvedTicket,
		createdTickets,
		resolutionPosted: true as const,
		decisionRecorded: true as const,
	};
}
