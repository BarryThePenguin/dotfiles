/**
 * Local markdown format for generic Issues.
 *
 * A generic Issue file is a single markdown document:
 *
 *   # <title>
 *
 *   Status: <comma-separated labels>   (omitted when unlabeled)
 *   Closed: <iso-timestamp>            (omitted when open)
 *   Updated: <iso-timestamp>           (optional)
 *
 *   <body paragraphs>
 *
 *   ## Comments
 *   > comment 1
 *   > comment 2
 *
 *   ## Answer
 *   <answer paragraphs>
 *
 * The `Status:` line is the local rendering of `Issue.labels`; a file with
 * no `Status:` line is the local "unlabeled" bucket. The `Closed:` line
 * marks the issue as closed and provides its `updatedAt`. The `## Answer`
 * section is the local rendering of the resolution comment; the
 * `## Comments` section holds any other comments.
 */

import type { RootContent } from "mdast";
import { u } from "unist-builder";
import {
	blockquote,
	heading,
	listItemTexts,
	markdownBlocks,
	paragraph,
	stringifyChildren,
	stringifyMarkdown,
	text,
} from "./markdown.ts";
import type { IssueStatus } from "./issue.ts";
import { markdownDocument, type WayfinderMarkdownDocument } from "./wayfinder-markdown.ts";

export type IssueFileBody = {
	title: string;
	body: string;
	labels: string[];
	status: IssueStatus;
	updatedAt?: string;
	comments: string[];
	answer?: string;
};

export function issueMarkdown(input: {
	title: string;
	body: string;
	labels: string[];
	status: IssueStatus;
	updatedAt?: string;
	comments?: { content: string; postedAt?: string }[];
	answer?: string;
}): string {
	const headers: string[] = [];
	if (input.labels.length > 0) {
		headers.push(`Status: ${input.labels.join(", ")}`);
	}
	if (input.status === "closed" && input.updatedAt) {
		headers.push(`Closed: ${input.updatedAt}`);
	}

	const children: RootContent[] = [heading(1, [text(input.title)])];
	if (headers.length > 0) {
		children.push(paragraph(headers.join("\n")));
	}
	children.push(...markdownBlocks(input.body));
	if (input.comments && input.comments.length > 0) {
		children.push(heading(2, [text("Comments")]));
		for (const comment of input.comments) {
			children.push(blockquote(comment.content));
		}
	}
	if (input.answer) {
		children.push(heading(2, [text("Answer")]), ...markdownBlocks(input.answer));
	}
	return stringifyMarkdown(u("root", children));
}

function sectionContent(
	document: WayfinderMarkdownDocument,
	heading: string,
): string {
	return stringifyChildren(document.section(heading));
}

function parseLabels(headerValue: string | undefined): string[] {
	if (!headerValue) {
		return [];
	}
	return headerValue
		.split(/[,\n]/)
		.map((label) => label.trim())
		.filter((label) => label.length > 0);
}

export function issueFileBodyFromDocument(
	document: WayfinderMarkdownDocument,
): IssueFileBody {
	const header = document.header("Status");
	const labels = parseLabels(header);
	const closedHeader = document.header("Closed");
	const updatedAt = closedHeader ?? document.header("Updated");
	const status: IssueStatus = closedHeader ? "closed" : "open";

	const commentsSection = document.section("Comments");
	const comments = splitCommentSection(commentsSection);

	const answerSection = document.section("Answer");
	const answer =
		answerSection.length > 0 ? sectionContent(document, "Answer") : undefined;

	const bodyNodes = bodyNodesBetweenHeaderAndSections(document);
	const body = stringifyChildren(bodyNodes).trim();

	return {
		title: document.title() ?? "Untitled",
		body,
		labels,
		status,
		...(updatedAt ? { updatedAt } : {}),
		comments,
		...(answer ? { answer } : {}),
	};
}

function splitCommentSection(nodes: RootContent[]): string[] {
	const result: string[] = [];
	for (const node of nodes) {
		if (node.type === "blockquote") {
			result.push(
				extractBlockquoteText(node).trim(),
			);
			continue;
		}
		if (node.type === "list") {
			result.push(...listItemTexts([node]));
			continue;
		}
		const text = stringifyChildren([node]).trim();
		if (text.length > 0) {
			result.push(text);
		}
	}
	return result.filter((comment) => comment.length > 0);
}

type BlockContent = Extract<RootContent, { type: "blockquote" }>;

function extractBlockquoteText(node: BlockContent): string {
	return node.children
		.map((child) => stringifyChildren([child]).trim())
		.filter((line) => line.length > 0)
		.join("\n\n");
}

function bodyNodesBetweenHeaderAndSections(
	document: WayfinderMarkdownDocument,
): RootContent[] {
	const children = document.root.children;
	const titleIndex = children.findIndex(
		(node) => node.type === "heading" && node.depth === 1,
	);
	const firstH2Section = document.index.sections.find(
		(section) => section.depth >= 2,
	);
	const firstSectionIndex = firstH2Section?.start ?? children.length;
	const headerIndex = document.index.localHeaders.length > 0
		? children.findIndex(
				(node, index) =>
					node.type === "paragraph" &&
					(titleIndex === -1 || index > titleIndex) &&
					index < firstSectionIndex,
			)
		: -1;
	const start =
		headerIndex >= 0
			? headerIndex + 1
			: titleIndex >= 0
				? titleIndex + 1
				: 0;
	return children.slice(start, firstSectionIndex);
}

export function issueFileBodyFromMarkdown(markdown: string): IssueFileBody {
	return issueFileBodyFromDocument(markdownDocument(markdown));
}
