// Internal — used by actions.ts only, not part of the public surface.

/**
 * Tool-response renderers: turn domain records into the markdown text that
 * action handlers pass to runtime.success(). Adapters control the result
 * shape; this module controls only the text content.
 */

import type { ListItem, RootContent } from "mdast";
import {
	blockquote,
	heading,
	link,
	list,
	listItem,
	markdownBlocks,
	paragraph,
	stringifyChildren,
	strong,
	text,
} from "./markdown.ts";
import type { Issue } from "./issue.ts";
import type { WayfinderTrackerMap, WayfinderTrackerTicket } from "./tracker.ts";

const WAYFINDER_PREFIX = "Wayfinder:";

/** Strip the tool-name prefix when a map title carries it. */
export function stripPrefix(title: string): string {
	return title.startsWith(`${WAYFINDER_PREFIX} `)
		? title.slice(WAYFINDER_PREFIX.length + 1)
		: title;
}

function emptyParagraph() {
	return paragraph("(empty)");
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

export function renderMapSummary(
	map: WayfinderTrackerMap,
	openCount: number,
	closedCount: number,
): string {
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

export function renderTicketDetails(
	ticket: WayfinderTrackerTicket,
	blockerTitles: string[],
): string {
	const question = markdownBlocks(ticket.question);
	const blockedBy =
		blockerTitles.length > 0 ? blockerTitles.join(", ") : "nothing";
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

export function renderResolution(resolution: string): string {
	return renderResolutionBody(markdownBlocks(resolution));
}

export function renderIssueDetails(issue: Issue): string {
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
