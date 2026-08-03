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
	stringifyChildren,
	stringifyMarkdown,
	text,
} from "./markdown.ts";
import type { BlockerLink, ParsedTicketBody } from "./schema.ts";
import {
	markdownDocument,
	markdownDocumentFromRoot,
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
	setBlockedByOnRoot(root, input.blockers);
	return root;
}

function setBlockedByOnRoot(root: Root, blockers: BlockerLink[]): void {
	if (blockers.length === 0) {
		return;
	}
	root.children.push(
		heading(2, [text("Blocked by:")]),
		list(
			blockers.map((blocker) =>
				listItem([paragraph([link(blocker.url, [text(blocker.text)])])]),
			),
		),
	);
}

/** Replace the Blocked by section on a parsed document (removes then appends). */
export function setBlockedByOnDocument(
	document: WayfinderMarkdownDocument,
	blockers: BlockerLink[],
): void {
	document.removeSection("Blocked by");
	if (blockers.length > 0) {
		document.setSection(
			"Blocked by:",
			blockers.map((blocker) =>
				listItem([paragraph([link(blocker.url, [text(blocker.text)])])]),
			),
		);
	}
}

/** Set or clear the `Claimed by` header line on a parsed document. */
export function setClaimedByOnDocument(
	document: WayfinderMarkdownDocument,
	claimant: string | undefined,
): void {
	document.setHeader("Claimed by", claimant);
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

export function setBlockedBySection(
	markdown: string,
	blockers: BlockerLink[],
): string {
	const document = markdownDocument(markdown);
	setBlockedByOnDocument(document, blockers);
	return document.stringify();
}

export function setClaimedBy(
	markdown: string,
	claimant: string | undefined,
): string {
	const document = markdownDocument(markdown);
	setClaimedByOnDocument(document, claimant);
	return document.stringify();
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
	if (!input.claimedBy) {
		return stringifyMarkdown(root);
	}
	const document = markdownDocumentFromRoot(root);
	document.setHeader("Claimed by", input.claimedBy);
	return document.stringify();
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
