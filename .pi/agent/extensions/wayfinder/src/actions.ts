/**
 * Wayfinder tool action handlers.
 *
 * This file is the Pi adapter: it translates Pi tool params/session state into
 * domain-level WayfinderTracker calls and formats human-readable responses.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LocalTicket, MapSectionKey } from "wayfinder-core";
import { ok, stripPrefix } from "./helpers.ts";
import {
	createWayfinderTracker,
	localTrackerRoot,
	selectedTrackerMode,
	type TrackerMode,
} from "./tracker.ts";
import type {
	ChartParams,
	ClaimParams,
	CreateTicketParams,
	GetMapParams,
	GetTicketParams,
	ListFrontierParams,
	ResolveParams,
	SetBlockingParams,
	UpdateMapParams,
} from "./schemas.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ActionResult = {
	content: { type: "text"; text: string }[];
	details: unknown;
};

export interface ActionMap {
	list_maps: Record<string, never>;
	chart: ChartParams;
	get_map: GetMapParams;
	create_ticket: CreateTicketParams;
	get_ticket: GetTicketParams;
	resolve: ResolveParams;
	update_map: UpdateMapParams;
	set_blocking: SetBlockingParams;
	list_frontier: ListFrontierParams;
	claim: ClaimParams;
}

export interface ToolContext {
	activeMap: string | null;
	trackerMode: TrackerMode | null;
	resolveTrackerMode: (ext: ExtensionContext) => Promise<TrackerMode>;
	persistState: () => void;
	updateStatus: (ext: ExtensionContext) => void;
}

type Handler<K extends keyof ActionMap> = (
	params: ActionMap[K],
	ctx: ToolContext,
	ext: ExtensionContext,
) => Promise<ActionResult>;

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

const handlers: { [K in keyof ActionMap]: Handler<K> } = {
	list_maps: listMaps,
	chart,
	get_map: getMap,
	create_ticket: createTicket,
	get_ticket: getTicket,
	resolve,
	update_map: updateMap,
	set_blocking: setBlocking,
	list_frontier: listFrontier,
	claim,
};

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	return handlers[action](params, ctx, ext);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TITLE_MAX_LEN = 80;
const DEFAULT_CLAIMANT = "pi-wayfinder";

async function createTracker(ext: ExtensionContext, ctx: ToolContext) {
	const mode = await ctx.resolveTrackerMode(ext);
	return createWayfinderTracker({ cwd: ext.cwd, mode });
}

function trackerDetails(ext: ExtensionContext, ctx: ToolContext) {
	const mode = ctx.trackerMode ?? selectedTrackerMode(ext.cwd);
	return {
		tracker: mode,
		...(mode === "local" ? { root: localTrackerRoot(ext.cwd) } : {}),
	};
}

function truncateTitle(text: string): string {
	const firstLine = text.split("\n")[0] ?? "";
	if (firstLine.length <= TITLE_MAX_LEN) {
		return firstLine;
	}
	return `${firstLine.slice(0, TITLE_MAX_LEN - 1)}…`;
}

function requireMapId(
	params: { map_id?: string },
	ctx: ToolContext,
): string | null {
	return params.map_id ?? ctx.activeMap;
}

function formatTicket(ticket: LocalTicket, opts?: { showState?: boolean }) {
	const state = opts?.showState ? ` [${ticketState(ticket)}]` : "";
	return `${ticket.id} — ${ticket.title} (wayfinder:${ticket.type})${state}`;
}

function ticketState(ticket: LocalTicket) {
	if (ticket.claimedBy) {
		return "claimed";
	}
	if (ticket.blockerIds.length > 0) {
		return "blocked";
	}
	return "frontier";
}

function sectionKey(section: UpdateMapParams["section"]): MapSectionKey {
	return section === "decisions" ? "decisions" : section;
}

function mapDetails(
	ext: ExtensionContext,
	ctx: ToolContext,
	details: Record<string, unknown>,
) {
	return { ...trackerDetails(ext, ctx), ...details };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listMaps(
	_params: Record<string, never>,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const maps = await tracker.listMaps();
	if (maps.length === 0) {
		return ok("No open wayfinder maps.", mapDetails(ext, ctx, { maps: [] }));
	}
	return ok(
		`${maps.length} open map(s):\n\n${maps.map((map) => `${map.id} — ${stripPrefix(map.title)}\n  ${map.url}`).join("\n\n")}`,
		mapDetails(ext, ctx, {
			maps: maps.map((map) => ({
				id: map.id,
				title: map.title,
				url: map.url,
			})),
		}),
	);
}

async function chart(
	params: ChartParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const map = await tracker.createMap({
		title: params.title,
		destination: params.destination,
		...(params.notes ? { notes: params.notes } : {}),
	});
	ctx.activeMap = map.id;
	ctx.persistState();
	ctx.updateStatus(ext);
	return ok(
		`Map created: ${map.title}\nID: ${map.id}\nURL: ${map.url}\n\nDestination:\n${params.destination}`,
		mapDetails(ext, ctx, { id: map.id, url: map.url, title: map.title }),
	);
}

async function getMap(
	params: GetMapParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id provided and no active map.");
	}
	const [map, tickets] = await Promise.all([
		tracker.getMap(mapId),
		tracker.listChildTickets(mapId),
	]);
	const open = tickets.filter((ticket) => ticket.status === "open");
	const closed = tickets.filter((ticket) => ticket.status === "closed");

	const lines = [
		`## ${map.title}`,
		`ID: ${map.id}  URL: ${map.url}`,
		"",
		"### destination",
		map.destination || "(empty)",
		"",
		"### notes",
		map.notes || "(empty)",
		"",
		"### decisions",
		map.decisionsSoFar.length > 0
			? map.decisionsSoFar
					.map(
						(decision) =>
							`- [${decision.title}](${decision.url}) — ${decision.gist}`,
					)
					.join("\n")
			: "(empty)",
		"",
		"### notYetSpecified",
		map.notYetSpecified.length > 0
			? map.notYetSpecified.map((item) => `- ${item}`).join("\n")
			: "(empty)",
		"",
		"### outOfScope",
		map.outOfScope.length > 0
			? map.outOfScope
					.map((item) => `- ${item.text} — ${item.reason}`)
					.join("\n")
			: "(empty)",
		"",
		`Open tickets: ${open.length} (use wayfinder_list_frontier to choose the next ticket)`,
		`Closed tickets: ${closed.length}`,
	].join("\n");

	ctx.activeMap = mapId;
	ctx.persistState();
	ctx.updateStatus(ext);
	return ok(
		lines,
		mapDetails(ext, ctx, {
			id: map.id,
			title: map.title,
			url: map.url,
			sections: {
				destination: map.destination,
				notes: map.notes,
				decisions: map.decisionsSoFar,
				notYetSpecified: map.notYetSpecified,
				outOfScope: map.outOfScope,
			},
			openTickets: open.length,
			closedTickets: closed.length,
		}),
	);
}

async function createTicket(
	params: CreateTicketParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	const ticket = await tracker.createChildTicket({
		mapId,
		title: truncateTitle(params.question),
		type: params.type,
		question: params.question,
	});
	return ok(
		`Ticket created: ${ticket.title}\nID: ${ticket.id}\nType: ${params.type}\nURL: ${ticket.url}`,
		mapDetails(ext, ctx, {
			id: ticket.id,
			title: ticket.title,
			type: params.type,
			url: ticket.url,
		}),
	);
}

async function getTicket(
	params: GetTicketParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const ticket = await tracker.getTicket(params.ticket_id);
	const text = [
		`## ${ticket.title}`,
		`ID: ${ticket.id}  URL: ${ticket.url}`,
		`Type: ${ticket.type}`,
		`Blocked by: ${ticket.blockerIds.length > 0 ? ticket.blockerIds.join(", ") : "nothing"}`,
		`Claimed: ${ticket.claimedBy ?? "no"}`,
		"",
		`## Question\n\n${ticket.question}`,
		ticket.comments.length > 0
			? `\n### Comments (${ticket.comments.length})\n\n${ticket.comments.map((comment) => `> ${comment}`).join("\n\n")}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
	return ok(
		text,
		mapDetails(ext, ctx, {
			id: ticket.id,
			title: ticket.title,
			type: ticket.type,
			blockers: ticket.blockerIds,
			claimed: Boolean(ticket.claimedBy),
			comments: ticket.comments.length,
		}),
	);
}

async function resolve(
	params: ResolveParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const ticket = await tracker.getTicket(params.ticket_id);
	const mapId = ticket.mapId || ctx.activeMap;
	const usedFallback = !ticket.mapId && !!mapId;

	await tracker.postComment(
		params.ticket_id,
		`**Resolution:**\n\n${params.resolution}`,
	);
	await tracker.closeTicket(params.ticket_id);

	let unblocked: string[] = [];
	if (mapId) {
		await tracker.recordDecision(mapId, {
			title: ticket.title,
			url: ticket.url,
			gist: params.gist,
		});
		const siblings = await tracker.listChildTickets(mapId);
		unblocked = siblings
			.filter((sibling) => {
				if (
					sibling.status !== "open" ||
					!sibling.blockerIds.includes(params.ticket_id)
				) {
					return false;
				}
				const remaining = sibling.blockerIds.filter(
					(blockerId) => blockerId !== params.ticket_id,
				);
				return remaining.length === 0;
			})
			.map((sibling) => sibling.id);
	}

	const lines = [
		`Ticket ${params.ticket_id} resolved.`,
		`Gist: ${params.gist}`,
		usedFallback
			? `\nWarning: ticket was missing its map metadata — used the active map (${mapId}).`
			: "",
		unblocked.length > 0
			? `\nUnblocked tickets: ${unblocked.join(", ")}`
			: "\nNo tickets unblocked.",
	];

	return ok(
		lines.join("\n"),
		mapDetails(ext, ctx, {
			resolved: params.ticket_id,
			gist: params.gist,
			mapId,
			unblocked,
			usedFallback,
		}),
	);
}

async function updateMap(
	params: UpdateMapParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	await tracker.updateMapSection(
		mapId,
		sectionKey(params.section),
		params.content,
	);
	return ok(
		`Map section "${params.section}" updated.`,
		mapDetails(ext, ctx, { mapId, section: params.section }),
	);
}

async function setBlocking(
	params: SetBlockingParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	await tracker.setBlockingDependencies(params.ticket_id, params.blocked_by);
	const status =
		params.blocked_by.length > 0
			? `Blocked by: ${params.blocked_by.join(", ")}`
			: "Blocking cleared";
	return ok(
		`Ticket ${params.ticket_id}: ${status}`,
		mapDetails(ext, ctx, {
			ticketId: params.ticket_id,
			blockedBy: params.blocked_by,
		}),
	);
}

async function listFrontier(
	params: ListFrontierParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	const tickets = await tracker.listChildTickets(mapId);
	const frontier = await tracker.listFrontierTickets(mapId);
	const frontierIds = new Set(frontier.map((ticket) => ticket.id));
	const blocked: { ticket: LocalTicket; blockers: string[] }[] = [];
	const claimed: LocalTicket[] = [];

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

	if (frontier.length === 0 && blocked.length === 0 && claimed.length === 0) {
		return ok(
			"No open tickets on this map.",
			mapDetails(ext, ctx, { frontier, blocked, claimed }),
		);
	}

	const lines = [
		frontier.length > 0 &&
			`Frontier (${frontier.length} — ready to work):\n${frontier.map((ticket) => `  ${formatTicket(ticket)}`).join("\n")}`,
		blocked.length > 0 &&
			`Blocked (${blocked.length}):\n${blocked.map((item) => `  ${formatTicket(item.ticket)} (blocked by ${item.blockers.join(", ")})`).join("\n")}`,
		claimed.length > 0 &&
			`Claimed (${claimed.length}):\n${claimed.map((ticket) => `  ${formatTicket(ticket)}`).join("\n")}`,
	]
		.filter(Boolean)
		.join("\n\n");

	return ok(
		lines,
		mapDetails(ext, ctx, {
			frontier: frontier.map((ticket) => ({
				id: ticket.id,
				title: ticket.title,
			})),
			blocked: blocked.map((item) => ({
				id: item.ticket.id,
				title: item.ticket.title,
				blockedBy: item.blockers,
			})),
			claimed: claimed.map((ticket) => ({
				id: ticket.id,
				title: ticket.title,
			})),
		}),
	);
}

async function claim(
	params: ClaimParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createTracker(ext, ctx);
	const shouldClaim = params.claim !== false;
	if (shouldClaim) {
		await tracker.claimTicketIfUnclaimed(params.ticket_id, DEFAULT_CLAIMANT);
	} else {
		await tracker.unclaimTicket(params.ticket_id);
	}
	return ok(
		`${shouldClaim ? "Claimed" : "Unclaimed"} ticket ${params.ticket_id}`,
		mapDetails(ext, ctx, { ticketId: params.ticket_id, claimed: shouldClaim }),
	);
}

// ---------------------------------------------------------------------------
// Local error helper (in-band error result; matches the original contract)
// ---------------------------------------------------------------------------

function err(msg: string): ActionResult {
	return ok(`Error: ${msg}`);
}
