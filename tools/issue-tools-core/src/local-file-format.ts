import { basename } from "node:path";
import type { RootContent } from "mdast";
import { mapBodyRoot } from "./map-body.ts";
import {
	heading,
	markdownBlocks,
	paragraph,
	stringifyChildren,
	stringifyMarkdown,
	text,
} from "./markdown.ts";
import {
	setBlockedByOnDocument,
	ticketBodyFromDocument,
	ticketBodyRoot,
} from "./ticket-body.ts";
import { TICKET_TYPES, type TicketType } from "./schema.ts";
import type { CreateWayfinderMapInput } from "./tracker.ts";
import type { WayfinderMarkdownDocument } from "./wayfinder-markdown.ts";

export type LocalTicketFileBody = {
	title: string;
	type: TicketType;
	status: string;
	question: string;
	blockerRefs: string[];
	claimedBy?: string;
	answer?: string;
	comments: string[];
};

const VALID_TICKET_TYPES = new Set<TicketType>(TICKET_TYPES);

export function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "item";
}

export function titleFromSlug(slug: string): string {
	return slug
		.split("-")
		.filter(Boolean)
		.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
		.join(" ");
}

export function mapMarkdown(
	title: string,
	input: CreateWayfinderMapInput,
): string {
	const root = mapBodyRoot({
		destination: markdownBlocks(input.destination),
		notes: markdownBlocks(input.notes ?? ""),
		decisionsSoFar: [],
		notYetSpecified: input.notYetSpecified ?? [],
		outOfScope: [],
	});
	root.children.unshift(heading(1, [text(title)]));
	return stringifyMarkdown(root);
}

/** Local layout: a blocker ref renders as a link to its sibling file. */
export function setBlockedByRefsOnDocument(
	document: WayfinderMarkdownDocument,
	refs: string[],
): void {
	setBlockedByOnDocument(
		document,
		refs.map((ref) => ({ text: ref, url: `${ref}.md` })),
	);
}

export function setAnswerOnDocument(
	document: WayfinderMarkdownDocument,
	content: string,
): void {
	document.setSection("Answer", markdownBlocks(content));
}

export function stripResolutionHeading(body: string): string {
	return body.replace(/^\*\*Resolution:\*\*\s*/i, "").trim();
}

export function ticketMarkdown(input: {
	number: number;
	title: string;
	type: TicketType;
	status: string;
	question: string;
	blockerRefs: string[];
	claimedBy?: string;
	answer?: RootContent[];
	comments?: RootContent[];
}): string {
	const number = String(input.number).padStart(2, "0");
	const headers = [`Type: ${input.type}`, `Status: ${input.status}`];
	if (input.claimedBy) {
		headers.push(`Claimed by: ${input.claimedBy}`);
	}
	const root = ticketBodyRoot({
		question: markdownBlocks(input.question),
		blockers: input.blockerRefs.map((ref) => ({
			text: ref,
			url: `${ref}.md`,
		})),
	});
	root.children.unshift(
		heading(1, [text(`${number} — ${input.title}`)]),
		paragraph(headers.join("\n")),
	);
	if (input.answer) {
		root.children.push(heading(2, [text("Answer")]), ...input.answer);
	}
	if (input.comments && input.comments.length > 0) {
		root.children.push(heading(2, [text("Comments")]), ...input.comments);
	}
	return stringifyMarkdown(root);
}

export function ticketFileBodyFromDocument(
	document: WayfinderMarkdownDocument,
): LocalTicketFileBody {
	const type = document.header("Type");
	if (!type || !VALID_TICKET_TYPES.has(type as TicketType)) {
		throw new Error(`Invalid or missing Wayfinder ticket Type: ${type ?? ""}`);
	}

	const body = ticketBodyFromDocument(document);
	const blockerRefs = body.blockers.map((link) => link.text);
	const answer = stringifyChildren(document.section("Answer"));
	const title = document.title();
	if (!title) {
		throw new Error("Invalid or missing Wayfinder ticket title");
	}
	const status = document.header("Status");
	if (!status) {
		throw new Error("Invalid or missing Wayfinder ticket Status");
	}

	return {
		title: title.replace(/^\d+\s+—\s+/, ""),
		type: type as TicketType,
		status,
		question: body.question,
		blockerRefs,
		...(body.claimedBy ? { claimedBy: body.claimedBy } : {}),
		...(answer ? { answer } : {}),
		comments: ticketCommentsFromNodes(document.section("Comments")),
	};
}

function ticketCommentsFromNodes(nodes: RootContent[]): string[] {
	return nodes
		.map((node) =>
			node.type === "blockquote"
				? stringifyChildren(node.children)
				: stringifyChildren([node]),
		)
		.map((comment) => comment.trim())
		.filter(Boolean);
}

export function ticketRefFromId(id: string): string {
	const normalized = id.replace(/\.md$/, "");
	if (normalized.includes("/issues/")) {
		return basename(normalized);
	}
	return normalized.split("/").at(-1) ?? normalized;
}

export function normalizeTicketIdForMap(mapId: string, refOrId: string): string {
	const withoutMarkdown = refOrId.replace(/\.md$/, "");
	if (withoutMarkdown.includes("/issues/")) {
		const match = /([^/]+)\/issues\/([^/]+)$/.exec(withoutMarkdown);
		return match ? `${match[1]}/${match[2]}` : withoutMarkdown;
	}
	if (withoutMarkdown.includes("/")) {
		return withoutMarkdown;
	}
	return `${mapId}/${withoutMarkdown}`;
}

export function ticketNumberFromRef(ref: string): number | undefined {
	const match = /^(\d+)-/.exec(ref);
	return match ? Number(match[1]) : undefined;
}

export function mapFileUrl(mapId: string): string {
	return `${mapId}/map.md`;
}

export function ticketFileUrl(ref: string): string {
	return `issues/${ref}.md`;
}

export function compareTicketIds(a: string, b: string): number {
	const refA = ticketRefFromId(a);
	const refB = ticketRefFromId(b);
	const numberA = ticketNumberFromRef(refA);
	const numberB = ticketNumberFromRef(refB);
	if (numberA !== undefined && numberB !== undefined && numberA !== numberB) {
		return numberA - numberB;
	}
	return a.localeCompare(b);
}
