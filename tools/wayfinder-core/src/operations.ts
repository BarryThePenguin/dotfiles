import type { WayfinderTracker } from "./tools.ts";
import type { TicketType } from "./schema.ts";

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

	await tracker.postComment(ticket.id, input.resolution);
	const resolvedTicket = await tracker.closeTicket(ticket.id);
	const map = await tracker.recordDecision(input.mapId, {
		title: resolvedTicket.title,
		url: resolvedTicket.url,
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
		map,
		resolvedTicket,
		createdTickets,
		resolutionPosted: true as const,
		decisionRecorded: true as const,
	};
}
