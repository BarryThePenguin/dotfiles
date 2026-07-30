import { basename } from "node:path";
import type { List, Root, RootContent } from "mdast";
import { u } from "unist-builder";
import { mapBodyRoot } from "./map-body.ts";
import {
	listItemTexts,
	heading,
	link,
	list,
	listItem,
	markdownBlocks,
	paragraph,
	text,
	removeSection,
	replaceSection,
	stringifyChildren,
	stringifyMarkdown,
} from "./markdown.ts";
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

function sectionContent(
	document: WayfinderMarkdownDocument,
	heading: string,
): string {
	return stringifyChildren(document.section(heading));
}

function ticketRefList(refs: string[]): List {
	return list(
		refs.map((ref) => listItem([paragraph([link(`${ref}.md`, [text(ref)])])])),
	);
}

function ticketRefsFromNodes(nodes: RootContent[]): string[] {
	const looseLines = nodes
		.filter((node) => node.type !== "html" && node.type !== "list")
		.flatMap((node) => stringifyChildren([node]).split("\n"));

	return [...listItemTexts(nodes), ...looseLines]
		.flatMap((line) => line.split(/,/))
		.map((ref) => ref.trim())
		.filter((ref) => ref.length > 0 && !/^none$/i.test(ref));
}

export function setBlockedBySectionOnRoot(root: Root, refs: string[]): void {
	removeSection(root, "Blocked by", { stopAtWayfinderMetadata: true });
	if (refs.length > 0) {
		replaceSection(root, "Blocked by:", [ticketRefList(refs)], {
			stopAtWayfinderMetadata: true,
		});
	}
}

export function setSectionOnRoot(
	root: Root,
	heading: string,
	content: string,
): void {
	replaceSection(root, heading, markdownBlocks(content));
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
	const children: RootContent[] = [
		heading(1, [text(`${number} — ${input.title}`)]),
		paragraph(headers.join("\n")),
		heading(2, [text("Question")]),
		...markdownBlocks(input.question),
	];
	if (input.blockerRefs.length > 0) {
		children.push(heading(2, [text("Blocked by:")]), ticketRefList(input.blockerRefs));
	}
	if (input.answer) {
		children.push(heading(2, [text("Answer")]), ...input.answer);
	}
	if (input.comments && input.comments.length > 0) {
		children.push(heading(2, [text("Comments")]), ...input.comments);
	}
	return stringifyMarkdown(u("root", children));
}

export function ticketFileBodyFromDocument(
	document: WayfinderMarkdownDocument,
): LocalTicketFileBody {
	const type = document.header("Type");
	if (!type || !VALID_TICKET_TYPES.has(type as TicketType)) {
		throw new Error(`Invalid or missing Wayfinder ticket Type: ${type ?? ""}`);
	}

	const blockedByNodes = document.section("Blocked by", {
		stopAtWayfinderMetadata: true,
	});
	const legacyBlockedBy = document.header("Blocked by") ?? "None";
	const blockerRefs = blockedByNodes.length > 0
		? ticketRefsFromNodes(blockedByNodes)
		: /^none\b/i.test(legacyBlockedBy)
			? []
			: legacyBlockedBy
					.split(/[,\n]/)
					.map((ref) => ref.trim())
					.filter(Boolean);
	const answer = sectionContent(document, "Answer");
	const claimedBy = document.header("Claimed by");

	return {
		title: (document.title() ?? "Untitled").replace(/^\d+\s+—\s+/, ""),
		type: type as TicketType,
		status: document.header("Status") ?? "open",
		question: sectionContent(document, "Question"),
		blockerRefs,
		...(claimedBy ? { claimedBy } : {}),
		...(answer ? { answer } : {}),
		comments: sectionContent(document, "Comments")
			.split(/\n\s*\n/)
			.map((comment) => comment.trim())
			.filter(Boolean),
	};
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
