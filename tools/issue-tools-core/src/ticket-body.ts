import type { Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
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
import type { BlockerLink, ParsedTicketBody } from "./schema.ts";
import {
	markdownDocument,
	setHeaderOnRoot,
	type WayfinderMarkdownDocument,
} from "./wayfinder-markdown.ts";

/**
 * The shared Decision ticket body: a Question section, a Blocked by section
 * (a list of links), and a Claimed by header line. This is the format both
 * trackers write — Todoist as the task description, Local Markdown as the
 * body of a ticket file with its own envelope (title, Type/Status headers,
 * Answer, Comments) on top. Blockers are format-neutral links: each tracker
 * interprets text/url as its own id style.
 */
export function ticketBodyRoot(input: {
	question: RootContent[];
	blockers: BlockerLink[];
}): Root {
	const root = u("root", [heading(2, [text("Question")]), ...input.question]);
	setBlockedBySectionOnRoot(root, input.blockers);
	return root;
}

function parseBlockerLinks(nodes: RootContent[]): BlockerLink[] {
	const links: BlockerLink[] = [];
	visit({ type: "root", children: nodes }, "link", (node) => {
		links.push({ text: toString(node), url: node.url });
	});
	// Dedupe by url, first occurrence wins.
	const seen = new Set<string>();
	const unique: BlockerLink[] = [];
	for (const link of links) {
		if (!seen.has(link.url)) {
			seen.add(link.url);
			unique.push(link);
		}
	}
	return unique;
}

export function setBlockedBySectionOnRoot(
	root: Root,
	blockers: BlockerLink[],
): void {
	removeSection(root, "Blocked by");
	if (blockers.length > 0) {
		root.children.push(
			heading(2, [text("Blocked by:")]),
			list(
				blockers.map((blocker) =>
					listItem([paragraph([link(blocker.url, [text(blocker.text)])])]),
				),
			),
		);
	}
}

export function setBlockedBySection(
	markdown: string,
	blockers: BlockerLink[],
): string {
	const root = parseMarkdown(markdown);
	setBlockedBySectionOnRoot(root, blockers);
	return stringifyMarkdown(root);
}

// `Claimed by` lives as a header line ("Claimed by: <name>") at the top of the
// body.
export function setClaimedByOnRoot(
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
	blockers: BlockerLink[];
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

export function ticketBodyFromDocument(
	document: WayfinderMarkdownDocument,
): ParsedTicketBody {
	const question = stringifyChildren(questionChildren(document));
	const claimedBy = document.header("Claimed by");

	return {
		question,
		blockers: parseBlockerLinks(document.section("Blocked by")),
		...(claimedBy ? { claimedBy } : {}),
	};
}

export function parseTicketBody(markdown: string): ParsedTicketBody {
	return ticketBodyFromDocument(markdownDocument(markdown));
}
