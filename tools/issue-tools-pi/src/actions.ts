/**
 * Wayfinder tool action handlers.
 *
 * This file is the Pi adapter: it translates Pi tool params/session state into
 * domain-level WayfinderTracker calls and formats human-readable responses.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	renderIssueDetails,
	renderMapSummary,
	renderResolution,
	renderTicketDetails,
	stripPrefix,
	type ChartParams,
	type ClaimParams,
	type CreateTicketParams,
	type GetMapParams,
	type GetTicketParams,
	type IssueCloseParams,
	type IssueCommentParams,
	type IssueCreateParams,
	type IssueLabelParams,
	type IssueListParams,
	type IssueReadParams,
	type ListFrontierParams,
	type MapSectionKey,
	type ResolveParams,
	type SetBlockingParams,
	type UpdateMapParams,
	type WayfinderTrackerTicket,
} from "issue-tools-core";
import {
	createActionRuntime,
	type ActionResult,
	type ActionRuntime,
} from "./action-runtime.ts";
import { type TrackerSession } from "./tracker.ts";
// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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

export interface ToolContext {
	trackerSession: TrackerSession;
}

type Handler<K extends keyof ActionMap> = (
	params: ActionMap[K],
	runtime: ActionRuntime,
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
	issue_create: createIssue,
	issue_read: readIssue,
	issue_label: labelIssue,
	issue_comment: commentIssue,
	issue_close: closeIssue,
	issue_list: listIssues,
};

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	return createActionRuntime(ext, ctx).then((runtime) =>
		handlers[action](params, runtime),
	);
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

function sectionKey(section: UpdateMapParams["section"]): MapSectionKey {
	return section === "decisions" ? "decisions" : section;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listMaps(
	_params: Record<string, never>,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const maps = await tracker.listMaps();
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
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const map = await tracker.createMap({
		title: params.title,
		destination: params.destination,
		...(params.notes ? { notes: params.notes } : {}),
	});
	runtime.setActiveMap(map.id);
	return runtime.success(
		`Map created: ${map.title} (${map.id})\nURL: ${map.url}\n\nDestination:\n${params.destination}`,
		{ id: map.id, url: map.url, title: map.title },
	);
}

async function getMap(
	params: GetMapParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id provided and no active map.");
	}
	const detail = await tracker.getMapDetail(mapId);
	const open = detail.openCount;
	const closed = detail.closedCount;

	const summary = renderMapSummary(detail.map, open, closed);

	runtime.setActiveMap(mapId);
	return runtime.success(summary, {
		id: detail.map.id,
		title: detail.map.title,
		url: detail.map.url,
		sections: {
			destination: detail.map.destination,
			notes: detail.map.notes,
			decisions: detail.map.decisionsSoFar,
			notYetSpecified: detail.map.notYetSpecified,
			outOfScope: detail.map.outOfScope,
		},
		openTickets: open,
		closedTickets: closed,
	});
}

async function createTicket(
	params: CreateTicketParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id and no active map.");
	}
	const ticket = await tracker.createChildTicket({
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
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const { ticket, blockers } = await tracker.getTicketDetail(params.ticket_id);
	const blockerTitles = blockers.map((blocker) => blocker.title);
	return runtime.success(renderTicketDetails(ticket, blockerTitles), {
		id: ticket.id,
		title: ticket.title,
		type: ticket.type,
		blockers: blockers.map((blocker) => blocker.id),
		blockerTitles,
		claimed: Boolean(ticket.claimedBy),
		comments: ticket.comments.length,
	});
}

async function resolve(
	params: ResolveParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const result = await tracker.resolveTicket({
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
		resolutionPosted: result.resolutionPosted,
		decisionRecorded: result.decisionRecorded,
		...(result.error ? { error: result.error } : {}),
	});
}

async function updateMap(
	params: UpdateMapParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id and no active map.");
	}
	const map = await tracker.updateMapSection(
		mapId,
		sectionKey(params.section),
		params.content,
	);
	return runtime.success(
		`Map ${stripPrefix(map.title)} (${map.id}) section "${params.section}" updated.`,
		{
			mapId,
			section: params.section,
		},
	);
}

async function setBlocking(
	params: SetBlockingParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const ticket = await tracker.setBlockingDependencies(
		params.ticket_id,
		params.blocked_by,
	);
	const detail = await tracker.getTicketDetail(ticket.id);
	const status =
		detail.blockers.length > 0
			? `Blocked by: ${detail.blockers.map(formatTicketReference).join(", ")}`
			: "Blocking cleared";
	return runtime.success(`Ticket ${formatTicketReference(ticket)}: ${status}`, {
		ticketId: ticket.id,
		blockedBy: detail.blockers.map((blocker) => blocker.id),
	});
}

async function listFrontier(
	params: ListFrontierParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const mapId = runtime.requireMapId(params);
	if (!mapId) {
		return runtime.error("no map_id and no active map.");
	}
	const { frontier, blocked, claimed } = await tracker.getMapDetail(mapId);

	if (frontier.length === 0 && blocked.length === 0 && claimed.length === 0) {
		return runtime.success("No open tickets on this map.", {
			frontier,
			blocked,
			claimed,
		});
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

	return runtime.success(lines, {
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
	});
}

async function claim(
	params: ClaimParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.wayfinder();
	const shouldClaim = params.claim !== false;
	let claimed = false;
	let ticket: WayfinderTrackerTicket;
	if (shouldClaim) {
		const result = await tracker.claimTicketIfUnclaimed(
			params.ticket_id,
			runtime.claimant(),
		);
		claimed = result.claimed;
		ticket = result.ticket;
	} else {
		ticket = await tracker.unclaimTicket(params.ticket_id);
	}
	return runtime.success(
		`${claimed ? "Claimed" : shouldClaim ? "Could not claim" : "Unclaimed"} ticket ${formatTicketReference(ticket)}`,
		{ ticketId: ticket.id, claimed },
	);
}

// ---------------------------------------------------------------------------
// Generic issue surface
// ---------------------------------------------------------------------------

async function createIssue(
	params: IssueCreateParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.issues();
	const issue = await tracker.createIssue({
		title: params.title,
		...(params.body !== undefined ? { body: params.body } : {}),
		...(params.labels !== undefined ? { labels: params.labels } : {}),
	});
	return runtime.success(
		`Issue created: ${issue.title}\nID: ${issue.id}\nURL: ${issue.url}`,
		{
			id: issue.id,
			url: issue.url,
			title: issue.title,
		},
	);
}

async function readIssue(
	params: IssueReadParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.issues();
	const issue = await tracker.readIssue(params.id);
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
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.issues();
	const issue = await tracker.updateIssueLabels(params.id, {
		...(params.add ? { add: [...params.add] } : {}),
		...(params.remove ? { remove: [...params.remove] } : {}),
	});
	return runtime.success(
		`Issue ${issue.id}: labels now ${formatLabelList(issue.labels)}`,
		{
			id: issue.id,
			url: issue.url,
			labels: issue.labels,
		},
	);
}

function formatLabelList(labels: string[]): string {
	return labels.length > 0 ? labels.join(", ") : "(none)";
}

async function commentIssue(
	params: IssueCommentParams,
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.issues();
	const { comment } = await tracker.commentOnIssue(params.id, params.body);
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
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.issues();
	const { status } = await tracker.closeIssue(
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
	runtime: ActionRuntime,
): Promise<ActionResult> {
	const tracker = runtime.issues();
	const issues = await tracker.listIssues({
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
