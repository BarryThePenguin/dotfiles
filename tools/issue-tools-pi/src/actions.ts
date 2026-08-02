/**
 * Wayfinder tool action handlers.
 *
 * This file is the Pi adapter: it translates Pi tool params/session state into
 * domain-level WayfinderTracker calls and formats human-readable responses.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	blockquote,
	heading,
	inspectFrontier,
	link,
	list,
	listItem,
	markdownBlocks,
	paragraph,
	resolveTicket,
	stringifyChildren,
	strong,
	text,
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
	type TrackerModules,
	type UpdateMapParams,
	type WayfinderTrackerMap,
	type WayfinderTrackerTicket,
} from "issue-tools-core";
import type { ListItem, RootContent } from "mdast";
import { localTrackerRoot, type TrackerMode } from "./tracker.ts";
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
	issue_create: IssueCreateParams;
	issue_read: IssueReadParams;
	issue_label: IssueLabelParams;
	issue_comment: IssueCommentParams;
	issue_close: IssueCloseParams;
	issue_list: IssueListParams;
}

export interface ToolContext {
	activeMap: string | null;
	trackerMode: TrackerMode | null;
	getTrackerModules: (ext: ExtensionContext) => Promise<TrackerModules>;
	persistState: () => void;
	updateStatus: (ext: ExtensionContext) => void;
}

type Handler<K extends keyof ActionMap> = (
	params: ActionMap[K],
	ctx: ToolContext,
	ext: ExtensionContext,
) => Promise<ActionResult>;

const WAYFINDER_PREFIX = "Wayfinder:";

function ok(text: string, details: unknown = {}): ActionResult {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function stripPrefix(title: string): string {
	return title.startsWith(`${WAYFINDER_PREFIX} `)
		? title.slice(WAYFINDER_PREFIX.length + 1)
		: title;
}

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
	return handlers[action](params, ctx, ext);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CLAIMANT = "pi-wayfinder";

async function createModules(ext: ExtensionContext, ctx: ToolContext) {
	return ctx.getTrackerModules(ext);
}

async function createWayfinder(ext: ExtensionContext, ctx: ToolContext) {
	const { wayfinder } = await createModules(ext, ctx);
	return wayfinder;
}

async function createIssues(ext: ExtensionContext, ctx: ToolContext) {
	const { issues } = await createModules(ext, ctx);
	return issues;
}

function trackerDetails(ext: ExtensionContext, ctx: ToolContext) {
	const mode = ctx.trackerMode ?? "local";
	return {
		tracker: mode,
		...(mode === "local" ? { root: localTrackerRoot(ext.cwd) } : {}),
	};
}

function requireMapId(
	params: { map_id?: string },
	ctx: ToolContext,
): string | null {
	return params.map_id ?? ctx.activeMap;
}

function formatTicket(
	ticket: WayfinderTrackerTicket,
	opts?: { showState?: boolean },
) {
	const state = opts?.showState ? ` [${ticketState(ticket)}]` : "";
	return `${ticket.id} — ${ticket.title} (wayfinder:${ticket.type})${state}`;
}

function emptyParagraph() {
	return paragraph("(empty)");
}

function ticketState(ticket: WayfinderTrackerTicket) {
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

function sectionNodes(title: string, content: RootContent[]): RootContent[] {
	return [
		heading(3, [text(title)]),
		...(content.length > 0 ? content : [emptyParagraph()]),
	];
}

function listSectionNodes(title: string, items: ListItem[]): RootContent[] {
	return [
		heading(3, [text(title)]),
		items.length > 0 ? list(items) : emptyParagraph(),
	];
}

function renderMapSummary(
	map: WayfinderTrackerMap,
	openCount: number,
	closedCount: number,
) {
	const destination = markdownBlocks(map.destination);
	const notes = markdownBlocks(map.notes);

	return stringifyChildren([
		heading(2, [text(map.title)]),
		paragraph([
			text(`ID: ${map.id}`),
			{ type: "break" },
			text(`URL: ${map.url}`),
		]),
		...sectionNodes("destination", destination),
		...sectionNodes("notes", notes),
		...listSectionNodes(
			"decisions",
			map.decisionsSoFar.map((decision) =>
				listItem([
					paragraph([
						link(decision.url, [text(decision.title)]),
						text(` — ${decision.gist}`),
					]),
				]),
			),
		),
		...listSectionNodes(
			"notYetSpecified",
			map.notYetSpecified.map((item) => listItem([paragraph([text(item)])])),
		),
		...listSectionNodes(
			"outOfScope",
			map.outOfScope.map((item) =>
				listItem([paragraph([text(`${item.text} — ${item.reason}`)])]),
			),
		),
		paragraph(
			`Open tickets: ${openCount} (use wayfinder_list_frontier to choose the next ticket)`,
		),
		paragraph(`Closed tickets: ${closedCount}`),
	]);
}

function renderTicketDetails(
	ticket: WayfinderTrackerTicket,
	blockerTitles?: string[],
): string {
	const question = markdownBlocks(ticket.question);
	const blockedBy =
		blockerTitles && blockerTitles.length > 0
			? blockerTitles.join(", ")
			: "nothing";
	const nodes: RootContent[] = [
		heading(2, [text(ticket.title)]),
		paragraph([
			text(`ID: ${ticket.id}`),
			{ type: "break" },
			text(`URL: ${ticket.url}`),
		]),
		paragraph(`Type: ${ticket.type} | Blocked by: ${blockedBy}`),
	];

	nodes.push(
		paragraph(`Claimed: ${ticket.claimedBy ?? "no"}`),
		heading(2, [text("Question")]),
		...question,
	);

	if (ticket.comments.length > 0) {
		nodes.push(
			heading(3, [text(`Comments (${ticket.comments.length})`)]),
			...ticket.comments.map((comment) => blockquote(comment)),
		);
	}

	return stringifyChildren(nodes);
}

function renderResolutionBody(resolution: RootContent[]): string {
	return stringifyChildren([
		paragraph([strong([text("Resolution:")])]),
		...resolution,
	]);
}

function renderResolution(resolution: string): string {
	return renderResolutionBody(markdownBlocks(resolution));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listMaps(
	_params: Record<string, never>,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createWayfinder(ext, ctx);
	const maps = await tracker.listMaps();
	if (maps.length === 0) {
		return ok("No open wayfinder maps.", mapDetails(ext, ctx, { maps: [] }));
	}
	if (maps.length === 1 && maps[0] && ctx.activeMap !== maps[0].id) {
		ctx.activeMap = maps[0].id;
		ctx.persistState();
		ctx.updateStatus(ext);
	}
	return ok(
		`${maps.length} open map(s):\n\n${maps.map((map) => `${map.id} — ${stripPrefix(map.title)}\n  ID: ${map.id}\n  URL: ${map.url}`).join("\n\n")}`,
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
	const tracker = await createWayfinder(ext, ctx);
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
	const tracker = await createWayfinder(ext, ctx);
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

	const summary = renderMapSummary(map, open.length, closed.length);

	ctx.activeMap = mapId;
	ctx.persistState();
	ctx.updateStatus(ext);
	return ok(
		summary,
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
	const tracker = await createWayfinder(ext, ctx);
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	const ticket = await tracker.createChildTicket({
		mapId,
		title: params.title,
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
	const tracker = await createWayfinder(ext, ctx);
	const ticket = await tracker.getTicket(params.ticket_id);
	const blockerTitles =
		ticket.blockerIds.length > 0
			? await Promise.all(
					ticket.blockerIds.map((id) =>
						tracker.getTicket(id).then((t) => t.title),
					),
				)
			: undefined;
	return ok(
		renderTicketDetails(ticket, blockerTitles),
		mapDetails(ext, ctx, {
			id: ticket.id,
			title: ticket.title,
			type: ticket.type,
			blockers: ticket.blockerIds,
			blockerTitles,
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
	const tracker = await createWayfinder(ext, ctx);
	const result = await resolveTicket(tracker, {
		mapId: params.map_id,
		ticketId: params.ticket_id,
		resolution: renderResolution(params.resolution),
		gist: params.gist,
	});

	const lines = [
		`Outcome: ${result.outcome}`,
		`Ticket: ${params.ticket_id}`,
		result.outcome === "complete"
			? "Resolution recorded, ticket closed, and map decision recorded."
			: result.outcome === "partial"
				? "Resolution recorded and ticket closed, but the map decision was not recorded. Retry this operation."
				: "Ticket is closed without a matching Resolution. Human inspection is required; no map decision was recorded.",
		result.error ? `Error: ${result.error}` : "",
		`Gist: ${params.gist}`,
		result.unblocked.length > 0
			? `Unblocked tickets: ${result.unblocked.join(", ")}`
			: "No tickets unblocked.",
	];

	return ok(
		lines.filter(Boolean).join("\n"),
		mapDetails(ext, ctx, {
			resolved: params.ticket_id,
			gist: params.gist,
			mapId: result.mapId,
			outcome: result.outcome,
			unblocked: result.unblocked,
			resolutionPosted: result.resolutionPosted,
			decisionRecorded: result.decisionRecorded,
			...(result.error ? { error: result.error } : {}),
		}),
	);
}

async function updateMap(
	params: UpdateMapParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createWayfinder(ext, ctx);
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
	const tracker = await createWayfinder(ext, ctx);
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
	const tracker = await createWayfinder(ext, ctx);
	const mapId = requireMapId(params, ctx);
	if (!mapId) {
		return err("no map_id and no active map.");
	}
	const { frontier, blocked, claimed } = await inspectFrontier(tracker, mapId);

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
	const tracker = await createWayfinder(ext, ctx);
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
// Generic issue surface
// ---------------------------------------------------------------------------

async function createIssue(
	params: IssueCreateParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createIssues(ext, ctx);
	const issue = await tracker.createIssue({
		title: params.title,
		...(params.body !== undefined ? { body: params.body } : {}),
		...(params.labels !== undefined ? { labels: params.labels } : {}),
	});
	return ok(
		`Issue created: ${issue.title}\nID: ${issue.id}\nURL: ${issue.url}`,
		mapDetails(ext, ctx, {
			id: issue.id,
			url: issue.url,
			title: issue.title,
		}),
	);
}

async function readIssue(
	params: IssueReadParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createIssues(ext, ctx);
	const issue = await tracker.readIssue(params.id);
	return ok(
		renderIssueDetails(issue),
		mapDetails(ext, ctx, {
			id: issue.id,
			url: issue.url,
			title: issue.title,
			labels: issue.labels,
			status: issue.status,
			comments: issue.comments.length,
		}),
	);
}

async function labelIssue(
	params: IssueLabelParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createIssues(ext, ctx);
	const issue = await tracker.updateIssueLabels(params.id, {
		...(params.add ? { add: [...params.add] } : {}),
		...(params.remove ? { remove: [...params.remove] } : {}),
	});
	return ok(
		`Issue ${issue.id}: labels now ${formatLabelList(issue.labels)}`,
		mapDetails(ext, ctx, {
			id: issue.id,
			url: issue.url,
			labels: issue.labels,
		}),
	);
}

function formatLabelList(labels: string[]): string {
	return labels.length > 0 ? labels.join(", ") : "(none)";
}

async function commentIssue(
	params: IssueCommentParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createIssues(ext, ctx);
	const { comment } = await tracker.commentOnIssue(params.id, params.body);
	return ok(
		`Comment posted on ${params.id}${comment.postedAt ? ` at ${comment.postedAt}` : ""}.`,
		mapDetails(ext, ctx, {
			id: params.id,
			comment: {
				content: comment.content,
				...(comment.postedAt ? { postedAt: comment.postedAt } : {}),
			},
		}),
	);
}

async function closeIssue(
	params: IssueCloseParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createIssues(ext, ctx);
	const { status } = await tracker.closeIssue(
		params.id,
		params.comment ? { comment: params.comment } : undefined,
	);
	return ok(
		`Issue ${params.id}: ${status}${params.comment ? ` (closing note posted)` : ""}`,
		mapDetails(ext, ctx, { id: params.id, status }),
	);
}

async function listIssues(
	params: IssueListParams,
	ctx: ToolContext,
	ext: ExtensionContext,
): Promise<ActionResult> {
	const tracker = await createIssues(ext, ctx);
	const issues = await tracker.listIssues({
		...(params.state ? { state: params.state } : {}),
		...(params.labels ? { labels: [...params.labels] } : {}),
		...(params.unlabeled ? { unlabeled: params.unlabeled } : {}),
	});
	if (issues.length === 0) {
		return ok(
			"No issues matched.",
			mapDetails(ext, ctx, { count: 0, issues: [] }),
		);
	}
	const lines = issues
		.map(
			(issue) =>
				`${issue.id} — ${issue.title} [${issue.status}] (${formatLabelList(issue.labels)})`,
		)
		.join("\n");
	return ok(
		`${issues.length} issue(s):\n${lines}`,
		mapDetails(ext, ctx, {
			count: issues.length,
			issues: issues.map((issue) => ({
				id: issue.id,
				url: issue.url,
				title: issue.title,
				status: issue.status,
				labels: issue.labels,
			})),
		}),
	);
}

function renderIssueDetails(issue: {
	id: string;
	url: string;
	title: string;
	body: string;
	labels: string[];
	status: "open" | "closed";
	comments: { content: string; postedAt?: string }[];
	createdAt?: string;
	updatedAt?: string;
}): string {
	const body = markdownBlocks(issue.body);
	const labelLine =
		issue.labels.length > 0 ? issue.labels.join(", ") : "(none)";
	const timestamps: string[] = [];
	if (issue.createdAt) {
		timestamps.push(`Created: ${issue.createdAt}`);
	}
	if (issue.updatedAt) {
		timestamps.push(`Updated: ${issue.updatedAt}`);
	}
	const nodes: RootContent[] = [
		heading(2, [text(issue.title)]),
		paragraph([
			text(`ID: ${issue.id}`),
			{ type: "break" },
			text(`URL: ${issue.url}`),
		]),
		paragraph(`Status: ${issue.status} | Labels: ${labelLine}`),
	];
	if (timestamps.length > 0) {
		nodes.push(paragraph(timestamps.join(" | ")));
	}
	nodes.push(heading(2, [text("Body")]), ...body);
	if (issue.comments.length > 0) {
		nodes.push(
			heading(2, [text(`Comments (${issue.comments.length})`)]),
			...issue.comments.map((comment) =>
				comment.postedAt
					? blockquote(
							[`${comment.content}\n`, `Posted: ${comment.postedAt}`].join(
								"\n",
							),
						)
					: blockquote(comment.content),
			),
		);
	}
	return stringifyChildren(nodes);
}

// ---------------------------------------------------------------------------
// Local error helper (in-band error result; matches the original contract)
// ---------------------------------------------------------------------------

function err(msg: string): ActionResult {
	return ok(`Error: ${msg}`);
}
