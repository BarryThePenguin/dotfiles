/**
 * Wayfinder tool action handlers.
 *
 * Each action is a named handler with a strictly-typed param bag, looked up
 * through a dispatch table. Adding/removing actions is enforced at compile
 * time by the ActionMap type, so the table is the source of truth.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CLAIMED_LABEL,
	MAP_LABEL,
	TodoistClient,
	parseBlockedBy,
	setBlockedBy,
} from "./tracker.ts";
import {
	appendDecision,
	buildInitialMapBody,
	parseMapBody,
	replaceSection,
} from "./map-body.ts";
import {
	formatTicket,
	getMapTickets,
	ok,
	stripPrefix,
	ticketState,
	ticketTypeLabel,
} from "./helpers.ts";
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
	chart: chart,
	get_map: getMap,
	create_ticket: createTicket,
	get_ticket: getTicket,
	resolve: resolve,
	update_map: updateMap,
	set_blocking: setBlocking,
	list_frontier: listFrontier,
	claim: claim,
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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listMaps(
	_params: Record<string, never>,
	_ctx: ToolContext,
	_ext: ExtensionContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const tasks = await client.listTasks({ labels: [MAP_LABEL] });
	const open = tasks.filter((t) => !t.isCompleted);
	if (open.length === 0) {
		return ok("No open wayfinder maps.", { maps: [] });
	}
	return ok(
		`${open.length} open map(s):\n\n${open.map((t) => `${t.id} — ${stripPrefix(t.content)}\n  ${t.url}`).join("\n\n")}`,
		{ maps: open.map((t) => ({ id: t.id, title: t.content, url: t.url })) },
	);
}

async function chart(
	params: ChartParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const task = await client.createTask({
		content: params.title,
		description: buildInitialMapBody(params.destination, params.notes ?? ""),
		labels: [MAP_LABEL],
	});
	ctx.activeMap = task.id;
	ctx.persistState();
	ctx.updateStatus(ext);
	return ok(
		`Map created: ${task.content}\nID: ${task.id}\nURL: ${task.url}\n\nDestination:\n${params.destination}`,
		{ id: task.id, url: task.url, title: task.content },
	);
}

async function getMap(
	params: GetMapParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id provided and no active map.");
	}
	const task = await client.getTask(mapId);
	const sections = parseMapBody(task.description || "");
	const [open, closed] = await Promise.all([
		getMapTickets(client, mapId, { completed: false }),
		getMapTickets(client, mapId, { completed: true }),
	]);

	const lines = [
		`## ${task.content}`,
		`ID: ${task.id}  URL: ${task.url}`,
		"",
		...(
			[
				"destination",
				"notes",
				"decisions",
				"notYetSpecified",
				"outOfScope",
			] as const
		).flatMap((s) => [`### ${s}`, sections[s] || "(empty)", ""]),
		`### Open tickets (${open.length})`,
		...open.map((t) => `  ${formatTicket(t, { showState: true })}`),
		"",
		`Closed tickets: ${closed.length}`,
	].join("\n");

	ctx.activeMap = mapId;
	ctx.persistState();
	ctx.updateStatus(ext);
	return ok(lines, {
		id: task.id,
		title: task.content,
		url: task.url,
		sections,
		openTickets: open.length,
		closedTickets: closed.length,
	});
}

async function createTicket(
	params: CreateTicketParams,
	ctx: ToolContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	const body = `## Question\n\n${params.question}`;
	const task = await client.createTask({
		content: truncateTitle(params.question),
		description: body,
		parentId: mapId,
		labels: [ticketTypeLabel(params.type)],
	});
	return ok(
		`Ticket created: ${task.content}\nID: ${task.id}\nType: ${params.type}\nURL: ${task.url}`,
		{ id: task.id, title: task.content, type: params.type, url: task.url },
	);
}

async function getTicket(
	params: GetTicketParams,
	_ctx: ToolContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const task = await client.getTask(params.ticket_id);
	const blockers = parseBlockedBy(task.description || "");
	const comments = await client.listComments(params.ticket_id);
	const text = [
		`## ${task.content}`,
		`ID: ${task.id}  URL: ${task.url}`,
		`Labels: ${task.labels.join(", ")}`,
		`Blocked by: ${blockers.length > 0 ? blockers.join(", ") : "nothing"}`,
		`Claimed: ${task.labels.includes(CLAIMED_LABEL) ? "yes" : "no"}`,
		"",
		task.description || "(no description)",
		comments.length > 0
			? `\n### Comments (${comments.length})\n\n${comments.map((c) => `> ${c.content}`).join("\n\n")}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
	return ok(text, {
		id: task.id,
		title: task.content,
		labels: task.labels,
		blockers,
		claimed: task.labels.includes(CLAIMED_LABEL),
		comments: comments.length,
	});
}

async function resolve(
	params: ResolveParams,
	ctx: ToolContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const ticket = await client.getTask(params.ticket_id);

	// Discover the map from the ticket's parent. Fall back to
	// the active map if parent is missing, and surface the fallback.
	const mapId = ticket.parentId ?? ctx.activeMap;
	const usedFallback = !ticket.parentId && !!mapId;

	await client.addComment(
		params.ticket_id,
		`**Resolution:**\n\n${params.resolution}`,
	);
	await client.completeTask(params.ticket_id);

	let unblocked: string[] = [];
	if (mapId) {
		const mapTask = await client.getTask(mapId);
		await client.updateTask(mapId, {
			description: appendDecision(
				mapTask.description || "",
				ticket.content,
				ticket.url,
				params.gist,
			),
		});
		const siblings = await getMapTickets(client, mapId, { completed: false });
		unblocked = siblings
			.filter((t) => {
				const blockers = parseBlockedBy(t.description || "");
				if (blockers.length === 0) {
					return false;
				}
				const remaining = blockers.filter((b) => b !== params.ticket_id);
				return remaining.length === 0;
			})
			.map((t) => t.id);
	}

	const lines = [
		`Ticket ${params.ticket_id} resolved.`,
		`Gist: ${params.gist}`,
		usedFallback
			? `\nWarning: ticket was missing the wayfinder:map tag — used the active map (${mapId}).`
			: "",
		unblocked.length > 0
			? `\nUnblocked tickets: ${unblocked.join(", ")}`
			: "\nNo tickets unblocked.",
	];

	return ok(lines.join("\n"), {
		resolved: params.ticket_id,
		gist: params.gist,
		mapId,
		unblocked,
		usedFallback,
	});
}

async function updateMap(
	params: UpdateMapParams,
	ctx: ToolContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	const mapTask = await client.getTask(mapId);
	await client.updateTask(mapId, {
		description: replaceSection(
			mapTask.description || "",
			params.section,
			params.content,
		),
	});
	return ok(`Map section "${params.section}" updated.`, {
		mapId,
		section: params.section,
	});
}

async function setBlocking(
	params: SetBlockingParams,
	_ctx: ToolContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const task = await client.getTask(params.ticket_id);
	await client.updateTask(params.ticket_id, {
		description: setBlockedBy(task.description || "", params.blocked_by),
	});
	const status =
		params.blocked_by.length > 0
			? `Blocked by: ${params.blocked_by.join(", ")}`
			: "Blocking cleared";
	return ok(`Ticket ${params.ticket_id}: ${status}`, {
		ticketId: params.ticket_id,
		blockedBy: params.blocked_by,
	});
}

async function listFrontier(
	params: ListFrontierParams,
	ctx: ToolContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	const tickets = await getMapTickets(client, mapId, { completed: false });
	const ticketMap = new Map(tickets.map((t) => [t.id, t]));
	const frontier: typeof tickets = [];
	const blocked: { ticket: (typeof tickets)[number]; blockers: string[] }[] =
		[];
	const claimed: typeof tickets = [];
	for (const t of tickets) {
		const state = ticketState(t);
		if (state === "claimed") {
			claimed.push(t);
		} else if (state === "blocked") {
			// Check if all blockers are actually open (uncompleted)
			const blockerIds = parseBlockedBy(t.description || "");
			const openBlockers = blockerIds.filter((id) => {
				const blocker = ticketMap.get(id);
				return blocker && !blocker.isCompleted;
			});
			if (openBlockers.length > 0) {
				blocked.push({ ticket: t, blockers: openBlockers });
			} else {
				// All blockers are closed, ticket is unblocked
				frontier.push(t);
			}
		} else {
			frontier.push(t);
		}
	}

	if (frontier.length === 0 && blocked.length === 0 && claimed.length === 0) {
		return ok("No open tickets on this map.", { frontier, blocked, claimed });
	}

	const lines = [
		frontier.length > 0 &&
			`Frontier (${frontier.length} — ready to work):\n${frontier.map((t) => `  ${formatTicket(t)}`).join("\n")}`,
		blocked.length > 0 &&
			`Blocked (${blocked.length}):\n${blocked.map((b) => `  ${formatTicket(b.ticket)} (blocked by ${b.blockers.join(", ")})`).join("\n")}`,
		claimed.length > 0 &&
			`Claimed (${claimed.length}):\n${claimed.map((t) => `  ${formatTicket(t)}`).join("\n")}`,
	]
		.filter(Boolean)
		.join("\n\n");

	return ok(lines, {
		frontier: frontier.map((t) => ({ id: t.id, title: t.content })),
		blocked: blocked.map((b) => ({
			id: b.ticket.id,
			title: b.ticket.content,
			blockedBy: b.blockers,
		})),
		claimed: claimed.map((t) => ({ id: t.id, title: t.content })),
	});
}

async function claim(
	params: ClaimParams,
	_ctx: ToolContext,
): Promise<ActionResult> {
	const client = new TodoistClient();
	const task = await client.getTask(params.ticket_id);
	const shouldClaim = params.claim !== false;
	const labels = shouldClaim
		? [...new Set([...task.labels, CLAIMED_LABEL])]
		: task.labels.filter((l) => l !== CLAIMED_LABEL);
	await client.updateTask(params.ticket_id, { labels });
	return ok(
		`${shouldClaim ? "Claimed" : "Unclaimed"} ticket ${params.ticket_id}`,
		{ ticketId: params.ticket_id, claimed: shouldClaim },
	);
}

// ---------------------------------------------------------------------------
// Local error helper (in-band error result; matches the original contract)
// ---------------------------------------------------------------------------

function err(msg: string): ActionResult {
	return ok(`Error: ${msg}`);
}
