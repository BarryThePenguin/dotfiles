import type { ResolutionPersistence } from "./persistence.ts";
import {
	ClosedTicketWithoutResolutionError,
	type ResolveTicketInput,
	type ResolveTicketResult,
	type WayfinderTrackerMap,
	type WayfinderTrackerTicket,
} from "./tracker.ts";
import { partitionOpenTickets } from "./tracker-operations.ts";

type ResolutionWorkflow = {
	resolve(input: ResolveTicketInput): Promise<ResolveTicketResult>;
};

/**
 * Owns the cross-record Resolution workflow: ticket validation, atomic
 * Resolution recording, frontier reclassification, and first-wins Decision
 * recording.
 */
export function createResolutionWorkflow(
	persistence: ResolutionPersistence,
): ResolutionWorkflow {
	return {
		resolve: (input) => resolve(input, persistence),
	};
}

async function resolve(
	input: ResolveTicketInput,
	persistence: ResolutionPersistence,
): Promise<ResolveTicketResult> {
	const initialTarget = await persistence.readResolutionTarget(input.ticketId);
	const { ticket } = initialTarget;
	if (!ticket.mapId) {
		throw new Error(`Ticket ${input.ticketId} has no map identity.`);
	}
	if (ticket.mapId !== input.mapId) {
		throw new Error(
			`Ticket ${input.ticketId} has map identity ${ticket.mapId}, not ${input.mapId}.`,
		);
	}

	// The context read validates the map before the adapter is allowed to mutate anything.
	if (initialTarget.map.id !== input.mapId) {
		throw new Error(`Map ${input.mapId} could not be loaded.`);
	}

	let resolvedTicket: WayfinderTrackerTicket;
	try {
		resolvedTicket = await persistence.recordResolution(
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
		};
	}

	// Re-read after the ticket mutation so frontier classification observes
	// the newly closed Decision ticket.
	const resolvedState = await persistence.readResolutionState(input.mapId);
	const partition = partitionOpenTickets(resolvedState.siblings);
	const unblockedIds = new Set(
		[...partition.frontier, ...partition.claimed]
			.filter((candidate) => candidate.blockerIds.includes(input.ticketId))
			.map((candidate) => candidate.id),
	);
	// Preserve sibling order in the report, while returning names as well as
	// identifiers so human-facing adapters do not have to perform another read.
	const unblocked = resolvedState.siblings
		.filter((candidate) => unblockedIds.has(candidate.id))
		.map(({ id, title, url }) => ({ id, title, url }));
	try {
		const map = await recordDecision(persistence, resolvedState.map, {
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
		};
	} catch (error) {
		return {
			outcome: "partial",
			resolvedTicket,
			mapId: input.mapId,
			unblocked,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function recordDecision(
	persistence: ResolutionPersistence,
	map: WayfinderTrackerMap,
	decision: { title: string; url: string; gist: string },
): Promise<WayfinderTrackerMap> {
	if (map.decisionsSoFar.some((existing) => existing.url === decision.url)) {
		return map;
	}
	return persistence.writeMapDecisions(map.id, [
		...map.decisionsSoFar,
		decision,
	]);
}
