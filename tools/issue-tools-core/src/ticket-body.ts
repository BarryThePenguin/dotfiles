import type { Root, RootContent } from "mdast";
import { u } from "unist-builder";
import { visit } from "unist-util-visit";
import {
	heading,
	link,
	list,
	listItem,
	markdownBlocks,
	paragraph,
	parseMarkdown,
	removeSection,
	stringifyChildren,
	stringifyMarkdown,
	text,
} from "./markdown.ts";
import type { ParsedTicketBody } from "./schema.ts";
import {
	markdownDocument,
	setHeaderOnRoot,
	type WayfinderMarkdownDocument,
} from "./wayfinder-markdown.ts";

export type BlockerRef = {
	id: string;
	title: string;
	url: string;
};

type TicketBodyRootInput = {
	question: RootContent[];
	blockers: BlockerRef[];
};

function ticketBodyRoot(input: TicketBodyRootInput): Root {
	const root = u("root", [heading(2, [text("Question")]), ...input.question]);
	setBlockedBySectionOnRoot(root, input.blockers);
	return root;
}

// Wayfinder writes `## Blocked by` as a list of links whose URL ends in the
// ticket id (the last path segment). Since we control the format, we parse
// exactly that — no legacy text fallback.
function blockerIdFromLink(url: string): string {
	return new URL(url).pathname.split("/").at(-1) ?? "";
}

function parseBlockerNodes(nodes: RootContent[]): string[] {
	const ids: string[] = [];
	visit({ type: "root", children: nodes }, "link", (node) => {
		const id = blockerIdFromLink(node.url);
		if (id) {
			ids.push(id);
		}
	});
	return Array.from(new Set(ids));
}

function setBlockedBySectionOnRoot(
	root: Root,
	blockers: BlockerRef[],
): void {
	removeSection(root, "Blocked by");
	if (blockers.length > 0) {
		root.children.push(
			heading(2, [text("Blocked by:")]),
			list(
				blockers.map((blocker) =>
					listItem([paragraph([link(blocker.url, [text(blocker.title)])])]),
				),
			),
		);
	}
}

export function setBlockedBySection(
	markdown: string,
	blockers: BlockerRef[],
): string {
	const root = parseMarkdown(markdown);
	setBlockedBySectionOnRoot(root, blockers);
	return stringifyMarkdown(root);
}

// `Claimed by` lives as a header line ("Claimed by: <name>") at the top of the
// body, mirroring the local file format.
function setClaimedByOnRoot(
	root: Root,
	claimant: string | undefined,
): void {
	setHeaderOnRoot(root, "Claimed by", claimant);
}

export function setClaimedBy(
	markdown: string,
	claimant: string | undefined,
): string {
	const root = parseMarkdown(markdown);
	setClaimedByOnRoot(root, claimant);
	return stringifyMarkdown(root);
}

function questionChildren(document: WayfinderMarkdownDocument): RootContent[] {
	return document
		.section("Question")
		.filter((node) => node.type !== "html");
}

export function renderTicketBody(input: {
	question: string;
	blockers: BlockerRef[];
	claimedBy?: string;
}): string {
	const root = ticketBodyRoot({
		question: markdownBlocks(input.question),
		blockers: input.blockers,
	});
	if (input.claimedBy) {
		setClaimedByOnRoot(root, input.claimedBy);
	}
	return stringifyMarkdown(root);
}

function ticketBodyFromDocument(
	document: WayfinderMarkdownDocument,
): ParsedTicketBody {
	const question = stringifyChildren(questionChildren(document));
	const claimedBy = document.header("Claimed by");

	const blockerNodes = document.section("Blocked by");

	return {
		question,
		blockerIds: parseBlockerNodes(blockerNodes),
		...(claimedBy ? { claimedBy } : {}),
	};
}

export function parseTicketBody(markdown: string): ParsedTicketBody {
	return ticketBodyFromDocument(markdownDocument(markdown));
}
