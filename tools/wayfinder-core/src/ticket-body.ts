import type { Heading, Paragraph, Root, RootContent, Text } from "mdast";
import { toString } from "mdast-util-to-string";
import { u } from "unist-builder";
import {
	parseMarkdown,
	stringifyChildren,
	stringifyMarkdown,
} from "./markdown.ts";
import { getMetadata, setMetadata } from "./metadata.ts";
import type { ParsedTicketBody, RenderTicketBodyInput } from "./schema.ts";

function text(value: string): Text {
	return u("text", value);
}

function heading(value: string): Heading {
	return u("heading", { depth: 2 } as const, [text(value)]);
}

function paragraph(value: string): Paragraph {
	return u("paragraph", [text(value)]);
}

function renderQuestionOnly(question: string): string {
	const root = u("root", [heading("Question"), paragraph(question)]);
	return stringifyMarkdown(root);
}

function questionChildren(root: Root): RootContent[] {
	let inQuestion = false;
	const children: RootContent[] = [];

	for (const node of root.children) {
		if (node.type === "heading" && node.depth === 2) {
			if (toString(node).trim().toLowerCase() === "question") {
				inQuestion = true;
				continue;
			}
			if (inQuestion) {
				break;
			}
		}

		if (inQuestion && node.type !== "html") {
			children.push(node);
		}
	}

	return children;
}

export function renderTicketBody(input: RenderTicketBodyInput): string {
	let markdown = renderQuestionOnly(input.question);
	if (input.mapId) {
		markdown = setMetadata(markdown, "map", [input.mapId]);
	}
	if (input.blockerIds.length > 0) {
		markdown = setMetadata(markdown, "blocked-by", input.blockerIds);
	}
	if (input.claimedBy) {
		markdown = setMetadata(markdown, "claimed-by", [input.claimedBy]);
	}
	return markdown;
}

function splitMetadataList(values: string[]): string[] {
	return values.flatMap((value) =>
		value
			.split(/[\s,]+/)
			.map((item) => item.trim())
			.filter(Boolean),
	);
}

export function parseTicketBody(markdown: string): ParsedTicketBody {
	const root = parseMarkdown(markdown);
	const question = stringifyChildren(questionChildren(root));
	const [mapId] = getMetadata(markdown, "map");
	const [claimedBy] = getMetadata(markdown, "claimed-by");

	return {
		question,
		...(mapId ? { mapId } : {}),
		blockerIds: splitMetadataList(getMetadata(markdown, "blocked-by")),
		...(claimedBy ? { claimedBy } : {}),
	};
}
