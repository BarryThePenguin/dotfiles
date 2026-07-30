import type { Root, RootContent } from "mdast";
import { u } from "unist-builder";
import {
	listItemTexts,
	heading,
	list,
	listItem,
	markdownBlocks,
	text,
	parseMarkdown,
	removeSection,
	stringifyChildren,
	stringifyMarkdown,
	paragraph,
} from "./markdown.ts";
import {
	markdownDocument,
	type WayfinderMarkdownDocument,
} from "./wayfinder-markdown.ts";
import { setMetadataOnRoot } from "./metadata.ts";
import type { ParsedTicketBody, RenderTicketBodyInput } from "./schema.ts";

export type TicketBodyRootInput = {
	question: RootContent[];
	blockerIds: string[];
};

export function ticketBodyRoot(input: TicketBodyRootInput): Root {
	const root = u("root", [heading(2, [text("Question")]), ...input.question]);
	setBlockedBySectionOnRoot(root, input.blockerIds);
	return root;
}

function parseBlockerNodes(nodes: RootContent[]): string[] {
	const looseLines = nodes
		.filter((node) => node.type !== "html" && node.type !== "list")
		.flatMap((node) => stringifyChildren([node]).split("\n"));

	return [...listItemTexts(nodes), ...looseLines]
		.flatMap((line) => line.split(/,/))
		.map((item) => item.trim())
		.filter((item) => item.length > 0 && !/^none$/i.test(item));
}

export function setBlockedBySectionOnRoot(
	root: Root,
	blockerIds: string[],
): void {
	removeSection(root, "Blocked by", { stopAtWayfinderMetadata: true });
	if (blockerIds.length > 0) {
		root.children.push(
			heading(2, [text("Blocked by:")]),
			list(
				blockerIds.map((blockerId) => listItem([paragraph([text(blockerId)])])),
			),
		);
	}
}

export function setBlockedBySection(
	markdown: string,
	blockerIds: string[],
): string {
	const root = parseMarkdown(markdown);
	setBlockedBySectionOnRoot(root, blockerIds);
	return stringifyMarkdown(root);
}

function questionChildren(document: WayfinderMarkdownDocument): RootContent[] {
	return document
		.section("Question", { stopAtWayfinderMetadata: true })
		.filter((node) => node.type !== "html");
}

export function renderTicketBody(input: RenderTicketBodyInput): string {
	const root = ticketBodyRoot({
		question: markdownBlocks(input.question),
		blockerIds: input.blockerIds,
	});
	if (input.mapId) {
		setMetadataOnRoot(root, "map", [input.mapId]);
	}
	if (input.claimedBy) {
		setMetadataOnRoot(root, "claimed-by", [input.claimedBy]);
	}
	return stringifyMarkdown(root);
}

function splitMetadataList(values: string[]): string[] {
	return values.flatMap((value) =>
		value
			.split(/[\s,]+/)
			.map((item) => item.trim())
			.filter(Boolean),
	);
}

export function ticketBodyFromDocument(
	document: WayfinderMarkdownDocument,
): ParsedTicketBody {
	const question = stringifyChildren(questionChildren(document));
	const [mapId] = document.metadata("map");
	const [claimedBy] = document.metadata("claimed-by");

	const blockerNodes = document.section("Blocked by", {
		stopAtWayfinderMetadata: true,
	});
	const blockerIds =
		blockerNodes.length > 0
			? parseBlockerNodes(blockerNodes)
			: splitMetadataList(document.metadata("blocked-by"));

	return {
		question,
		...(mapId ? { mapId } : {}),
		blockerIds,
		...(claimedBy ? { claimedBy } : {}),
	};
}

export function parseTicketBody(markdown: string): ParsedTicketBody {
	return ticketBodyFromDocument(markdownDocument(markdown));
}
