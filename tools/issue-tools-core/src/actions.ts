/**
 * Framework-agnostic action handlers for the Wayfinder and Issue tool surface.
 *
 * Adapters (Pi, OpenCode) produce an ActionRuntime<R> for their host and call
 * handleAction — they never see the handler bodies. Two adapters justify the
 * seam: both are real, not hypothetical.
 */

import type { IssueTracker } from "./issue.ts";
import {
	renderIssueDetails,
	renderMapSummary,
	renderResolution,
	renderTicketDetails,
	stripPrefix,
} from "./responses.ts";
import type {
	ChartParams,
	ClaimParams,
	CreateTicketParams,
	GetMapParams,
	GetTicketParams,
	IssueCloseParams,
	IssueCommentParams,
	IssueCreateParams,
	IssueLabelParams,
	IssueListParams,
	IssueReadParams,
	ListFrontierParams,
	ResolveParams,
	SetBlockingParams,
	UpdateMapParams,
} from "./tool-catalog.ts";
import type { WayfinderTracker, WayfinderTrackerTicket } from "./tracker.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActionRuntime<R> {
	readonly wayfinder: WayfinderTracker;
	readonly issues: IssueTracker;
	requireMapId(params: { map_id?: string }): string | null;
	getActiveMap(): string | null;
	setActiveMap(mapId: string): void;
	claimant(): string;
	success(text: string, details?: Record<string, unknown>): R;
	error(message: string): R;
}

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
	issue_create: IssueCreateParams;
	issue_read: IssueReadParams;
	issue_label: IssueLabelParams;
	issue_comment: IssueCommentParams;
	issue_close: IssueCloseParams;
	issue_list: IssueListParams;
}

// ---------------------------------------------------------------------------
// Internal dispatch
// ---------------------------------------------------------------------------

type AnyRuntime = ActionRuntime<unknown>;
type Handler<K extends keyof ActionMap> = (
	params: ActionMap[K],
	runtime: AnyRuntime,
) => Promise<unknown>;

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
	issue_create: createIssue,
	issue_read: readIssue,
	issue_label: labelIssue,
	issue_comment: commentIssue,
	issue_close: closeIssue,
	issue_list: listIssues,
};

export function handleAction<K extends keyof ActionMap, R>(
	action: K,
	params: ActionMap[K],
	runtime: ActionRuntime<R>,
): Promise<R> {
	return handlers[action](params, runtime) as Promise<R>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTicket(ticket: WayfinderTrackerTicket) {
	return `${ticket.title} (${ticket.id}) (wayfinder:${ticket.type})`;
}

function formatTicketReference(ticket: { id: string; title: string }) {
	return `${ticket.title} (${ticket.id})`;
}

function formatLabelList(labels: string[]): string {
	return labels.length > 0 ? labels.join(", ") : "(none)";
}

// ---------------------------------------------------------------------------
// Wayfinder handlers
// ---------------------------------------------------------------------------

async function listMaps(
	_params: Record<string, never>,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const maps = await wayfinder.listMaps();
	if (maps.length === 0) {
		return runtime.success("No open wayfinder maps.", { maps: [] });
	}
	if (maps.length === 1 && maps[0] && runtime.getActiveMap() !== maps[0].id) {
		runtime.setActiveMap(maps[0].id);
	}
	return runtime.success(
		`${maps.length} open map(s):\n\n${maps.map((map) => `${stripPrefix(map.title)} (${map.id})\n  URL: ${map.url}`).join("\n\n")}`,
		{
			maps: maps.map((map) => ({
				id: map.id,
				title: map.title,
				url: map.url,
			})),
		},
	);
}

async function chart(
	params: ChartParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const map = await wayfinder.createMap({
		title: params.title,
		destination: params.destination,
		...(params.notes !== undefined ? { notes: params.notes } : {}),
	});
	runtime.setActiveMap(map.id);
	return runtime.success(
		`Map created: ${map.title} (${map.id})\nURL: ${map.url}\n\nDestination:\n${params.destination}`,
		{ id: map.id, url: map.url, title: map.title },
	);
}

async function getMap(
	params: GetMapParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id provided and no active map.");
	}
	const {
		map,
		openCount: open,
		closedCount,
	} = await wayfinder.getMapDetail(mapId);
	const summary = renderMapSummary(map, open, closedCount);
	runtime.setActiveMap(mapId);
	return runtime.success(summary, {
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
		openTickets: open,
		closedTickets: closedCount,
	});
}

async function createTicket(
	params: CreateTicketParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id and no active map.");
	}
	const ticket = await wayfinder.createChildTicket({
		mapId,
		title: params.title,
		type: params.type,
		question: params.question,
	});
	return runtime.success(
		`Ticket created: ${ticket.title} (${ticket.id})\nType: ${params.type}\nURL: ${ticket.url}`,
		{
			id: ticket.id,
			title: ticket.title,
			type: params.type,
			url: ticket.url,
		},
	);
}

async function getTicket(
	params: GetTicketParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const { ticket, blockers } = await wayfinder.getTicketDetail(
		params.ticket_id,
	);
	const blockerTitles = blockers.map((b) => b.title);
	return runtime.success(renderTicketDetails(ticket, blockerTitles), {
		id: ticket.id,
		title: ticket.title,
		type: ticket.type,
		blockers: blockers.map((b) => b.id),
		blockerTitles,
		claimed: Boolean(ticket.claimedBy),
		comments: ticket.comments.length,
	});
}

async function resolve(
	params: ResolveParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const result = await wayfinder.resolveTicket({
		mapId: params.map_id,
		ticketId: params.ticket_id,
		resolution: renderResolution(params.resolution),
		gist: params.gist,
	});
	const lines = [
		`Outcome: ${result.outcome}`,
		`Ticket: ${formatTicketReference(result.resolvedTicket)}`,
		result.outcome === "complete"
			? "Resolution recorded, ticket closed, and map decision recorded."
			: result.outcome === "partial"
				? "Resolution recorded and ticket closed, but the map decision was not recorded. Retry this operation."
				: "Ticket is closed without a matching Resolution. Human inspection is required; no map decision was recorded.",
		result.error ? `Error: ${result.error}` : "",
		`Gist: ${params.gist}`,
		result.unblocked.length > 0
			? `Unblocked tickets: ${result.unblocked.map(formatTicketReference).join(", ")}`
			: "No tickets unblocked.",
	];
	return runtime.success(lines.filter(Boolean).join("\n"), {
		resolved: params.ticket_id,
		gist: params.gist,
		mapId: result.mapId,
		outcome: result.outcome,
		unblocked: result.unblocked,
		resolutionPosted: result.outcome !== "terminal",
		decisionRecorded: result.outcome === "complete",
		...(result.error ? { error: result.error } : {}),
	});
}

async function updateMap(
	params: UpdateMapParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id and no active map.");
	}
	const map = await wayfinder.updateMapSection(
		mapId,
		params.section,
		params.content,
	);
	return runtime.success(
		`Map ${stripPrefix(map.title)} (${map.id}) section "${params.section}" updated.`,
		{ mapId, section: params.section },
	);
}

async function setBlocking(
	params: SetBlockingParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const ticket = await wayfinder.setBlockingDependencies(
		params.ticket_id,
		params.blocked_by,
	);
	const detail = await wayfinder.getTicketDetail(ticket.id);
	const status =
		detail.blockers.length > 0
			? `Blocked by: ${detail.blockers.map(formatTicketReference).join(", ")}`
			: "Blocking cleared";
	return runtime.success(`Ticket ${formatTicketReference(ticket)}: ${status}`, {
		ticketId: ticket.id,
		blockedBy: detail.blockers.map((b) => b.id),
	});
}

async function listFrontier(
	params: ListFrontierParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id and no active map.");
	}
	const { frontier, blocked, claimed } = await wayfinder.getMapDetail(mapId);
	runtime.setActiveMap(mapId);
	if (frontier.length === 0 && blocked.length === 0 && claimed.length === 0) {
		return runtime.success("No open tickets on this map.", {
			frontier,
			blocked,
			claimed,
		});
	}
	const lines = [
		frontier.length > 0 &&
			`Frontier (${frontier.length} — ready to work):\n${frontier.map((t) => `  ${formatTicket(t)}`).join("\n")}`,
		blocked.length > 0 &&
			`Blocked (${blocked.length}):\n${blocked.map((item) => `  ${formatTicket(item.ticket)} (blocked by ${item.blockers.join(", ")})`).join("\n")}`,
		claimed.length > 0 &&
			`Claimed (${claimed.length}):\n${claimed.map((t) => `  ${formatTicket(t)}`).join("\n")}`,
	]
		.filter(Boolean)
		.join("\n\n");
	return runtime.success(lines, {
		frontier: frontier.map((t) => ({ id: t.id, title: t.title })),
		blocked: blocked.map((item) => ({
			id: item.ticket.id,
			title: item.ticket.title,
			blockedBy: item.blockers,
		})),
		claimed: claimed.map((t) => ({ id: t.id, title: t.title })),
	});
}

async function claim(
	params: ClaimParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { wayfinder } = runtime;
	const shouldClaim = params.claim !== false;
	let claimed = false;
	let ticket: WayfinderTrackerTicket;
	if (shouldClaim) {
		const result = await wayfinder.claimTicketIfUnclaimed(
			params.ticket_id,
			runtime.claimant(),
		);
		claimed = result.claimed;
		ticket = result.ticket;
	} else {
		ticket = await wayfinder.unclaimTicket(params.ticket_id);
	}
	return runtime.success(
		`${claimed ? "Claimed" : shouldClaim ? "Could not claim" : "Unclaimed"} ticket ${formatTicketReference(ticket)}`,
		{ ticketId: ticket.id, claimed },
	);
}

// ---------------------------------------------------------------------------
// Issue handlers
// ---------------------------------------------------------------------------

async function createIssue(
	params: IssueCreateParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { issues } = runtime;
	const issue = await issues.createIssue({
		title: params.title,
		...(params.body !== undefined ? { body: params.body } : {}),
		...(params.labels !== undefined ? { labels: params.labels } : {}),
	});
	return runtime.success(
		`Issue created: ${issue.title}\nID: ${issue.id}\nURL: ${issue.url}`,
		{ id: issue.id, url: issue.url, title: issue.title },
	);
}

async function readIssue(
	params: IssueReadParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { issues } = runtime;
	const issue = await issues.readIssue(params.id);
	return runtime.success(renderIssueDetails(issue), {
		id: issue.id,
		url: issue.url,
		title: issue.title,
		labels: issue.labels,
		status: issue.status,
		comments: issue.comments.length,
	});
}

async function labelIssue(
	params: IssueLabelParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { issues } = runtime;
	const issue = await issues.updateIssueLabels(params.id, {
		...(params.add ? { add: [...params.add] } : {}),
		...(params.remove ? { remove: [...params.remove] } : {}),
	});
	return runtime.success(
		`Issue ${issue.id}: labels now ${formatLabelList(issue.labels)}`,
		{ id: issue.id, url: issue.url, labels: issue.labels },
	);
}

async function commentIssue(
	params: IssueCommentParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { issues } = runtime;
	const { comment } = await issues.commentOnIssue(params.id, params.body);
	return runtime.success(
		`Comment posted on ${params.id}${comment.postedAt ? ` at ${comment.postedAt}` : ""}.`,
		{
			id: params.id,
			comment: {
				content: comment.content,
				...(comment.postedAt ? { postedAt: comment.postedAt } : {}),
			},
		},
	);
}

async function closeIssue(
	params: IssueCloseParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const { issues } = runtime;
	const { status } = await issues.closeIssue(
		params.id,
		params.comment ? { comment: params.comment } : undefined,
	);
	return runtime.success(
		`Issue ${params.id}: ${status}${params.comment ? ` (closing note posted)` : ""}`,
		{ id: params.id, status },
	);
}

async function listIssues(
	params: IssueListParams,
	runtime: AnyRuntime,
): Promise<unknown> {
	const issues = await runtime.issues.listIssues({
		...(params.state ? { state: params.state } : {}),
		...(params.labels ? { labels: [...params.labels] } : {}),
		...(params.unlabeled ? { unlabeled: params.unlabeled } : {}),
	});
	if (issues.length === 0) {
		return runtime.success("No issues matched.", { count: 0, issues: [] });
	}
	const lines = issues
		.map(
			(issue) =>
				`${issue.id} — ${issue.title} [${issue.status}] (${formatLabelList(issue.labels)})`,
		)
		.join("\n");
	return runtime.success(`${issues.length} issue(s):\n${lines}`, {
		count: issues.length,
		issues: issues.map((issue) => ({
			id: issue.id,
			url: issue.url,
			title: issue.title,
			status: issue.status,
			labels: issue.labels,
		})),
	});
}
