import type { Heading, Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified, type Transformer } from "unified";
import { VFile } from "vfile";
import { paragraph } from "./markdown.ts";

declare module "vfile" {
	interface DataMap {
		wayfinder?: WayfinderMarkdownIndex;
	}
}

export type WayfinderMarkdownSection = {
	title: string;
	normalizedTitle: string;
	depth: Heading["depth"];
	start: number;
	end: number;
};

export type WayfinderMarkdownHeader = {
	name: string;
	value: string;
};

export type WayfinderMarkdownIndex = {
	title?: string;
	sections: WayfinderMarkdownSection[];
	metadata: Record<string, string[]>;
	localHeaders: WayfinderMarkdownHeader[];
};

export type WayfinderMarkdownDocument = {
	root: Root;
	index: WayfinderMarkdownIndex;
	title: () => string | undefined;
	section: (
		title: string | string[],
		options?: { depth?: Heading["depth"]; stopAtWayfinderMetadata?: boolean },
	) => RootContent[];
	metadata: (key: string) => string[];
	header: (name: string) => string | undefined;
};

function normalizeSectionTitle(title: string): string {
	return title.trim().replace(/:$/, "").toLowerCase();
}

function readWayfinderMetadata(
	node: RootContent,
): { key: string; value: string } | undefined {
	if (node.type !== "html") {
		return undefined;
	}
	const match =
		/^<!--\s*wayfinder:([A-Za-z0-9_-]+):?(?:\s+([\s\S]*?))?\s*-->$/.exec(
			node.value.trim(),
		);
	if (!match?.[1]) {
		return undefined;
	}
	return { key: match[1], value: match[2]?.trim() ?? "" };
}

export function headerParagraphIndex(root: Root): number | undefined {
	const firstSectionIndex = root.children.findIndex(
		(node) => node.type === "heading" && node.depth >= 2,
	);
	const index = root.children.findIndex((node, nodeIndex) => {
		return (
			node.type === "paragraph" &&
			(firstSectionIndex === -1 || nodeIndex < firstSectionIndex) &&
			/^[A-Za-z][A-Za-z ]*:\s*/m.test(toString(node))
		);
	});
	return index === -1 ? undefined : index;
}

export function headerLines(root: Root): string[] {
	const index = headerParagraphIndex(root);
	if (index === undefined) {
		return [];
	}
	return toString(root.children[index] ?? { type: "text", value: "" }).split("\n");
}

function headerEntries(root: Root): WayfinderMarkdownHeader[] {
	return headerLines(root).flatMap((line) => {
		const match = /^([A-Za-z][A-Za-z ]*):\s*([\s\S]*)$/.exec(line.trim());
		return match?.[1]
			? [{ name: match[1], value: match[2]?.trim() ?? "" }]
			: [];
	});
}

export function setHeaderOnRoot(
	root: Root,
	name: string,
	value: string | undefined,
): void {
	const prefix = `${name}:`;
	const nextLine = value === undefined ? undefined : `${name}: ${value}`;
	const index = headerParagraphIndex(root);
	const lines = index === undefined ? [] : headerLines(root);
	const existingLineIndex = lines.findIndex((line) =>
		line.trim().toLowerCase().startsWith(prefix.toLowerCase()),
	);

	if (existingLineIndex === -1 && nextLine) {
		lines.push(nextLine);
	} else if (existingLineIndex !== -1 && nextLine) {
		lines[existingLineIndex] = nextLine;
	} else if (existingLineIndex !== -1) {
		lines.splice(existingLineIndex, 1);
	}

	if (index !== undefined) {
		if (lines.length > 0) {
			root.children[index] = paragraph(lines.join("\n"));
		} else {
			root.children.splice(index, 1);
		}
	} else if (lines.length > 0) {
		const insertAt = root.children[0]?.type === "heading" ? 1 : 0;
		root.children.splice(insertAt, 0, paragraph(lines.join("\n")));
	}
}

export function indexWayfinderMarkdown(root: Root): WayfinderMarkdownIndex {
	const sections: WayfinderMarkdownSection[] = [];
	const metadata: Record<string, string[]> = {};
	let title: string | undefined;

	for (const [index, node] of root.children.entries()) {
		if (node.type === "heading") {
			const headingTitle = toString(node).trim();
			if (title === undefined && node.depth === 1) {
				title = headingTitle;
			}
			if (node.depth >= 1 && node.depth <= 6) {
				sections.push({
					title: headingTitle,
					normalizedTitle: normalizeSectionTitle(headingTitle),
					depth: node.depth,
					start: index,
					end: root.children.length,
				});
			}
		}

		const entry = readWayfinderMetadata(node);
		if (entry) {
			metadata[entry.key] = [...(metadata[entry.key] ?? []), entry.value];
		}
	}

	for (const [index, section] of sections.entries()) {
		const nextPeerOrParent = sections
			.slice(index + 1)
			.find((candidate) => candidate.depth <= section.depth);
		section.end = nextPeerOrParent?.start ?? root.children.length;
	}

	return {
		...(title ? { title } : {}),
		sections,
		metadata,
		localHeaders: headerEntries(root),
	};
}

export function remarkWayfinderIndex(): Transformer<Root> {
	return (tree, file) => {
		file.data.wayfinder = indexWayfinderMarkdown(tree);
	};
}

const processor = unified()
	.use(remarkParse)
	.use(remarkWayfinderIndex)
	.use(remarkStringify, {
		bullet: "-",
		fences: true,
		listItemIndent: "one",
	});

export function markdownDocumentFromRoot(
	root: Root,
	index = indexWayfinderMarkdown(root),
): WayfinderMarkdownDocument {
	return {
		root,
		index,
		title: () => index.title,
		section: (title, options) => documentSectionChildren({ root, index }, title, options),
		metadata: (key) => index.metadata[key] ?? [],
		header: (name) =>
			index.localHeaders.find(
				(header) => header.name.toLowerCase() === name.toLowerCase(),
			)?.value,
	};
}

export function markdownDocument(markdown: string): WayfinderMarkdownDocument {
	const file = new VFile({ value: markdown });
	const root = processor.parse(file);
	processor.runSync(root, file);
	return markdownDocumentFromRoot(
		root,
		file.data.wayfinder ?? indexWayfinderMarkdown(root),
	);
}

export function documentSectionRange(
	document: Pick<WayfinderMarkdownDocument, "root" | "index">,
	title: string | string[],
	options: { depth?: Heading["depth"]; stopAtWayfinderMetadata?: boolean } = {},
): { start: number; end: number } | undefined {
	const depth = options.depth ?? 2;
	const expectedTitles = Array.isArray(title) ? title : [title];
	const normalizedTitles = new Set(expectedTitles.map(normalizeSectionTitle));
	const section = document.index.sections.find(
		(candidate) =>
			candidate.depth === depth &&
			normalizedTitles.has(candidate.normalizedTitle),
	);
	if (!section) {
		return undefined;
	}

	let end = section.end;
	if (options.stopAtWayfinderMetadata) {
		for (let index = section.start + 1; index < end; index += 1) {
			const node = document.root.children[index];
			if (node && isWayfinderMetadata(node)) {
				end = index;
				break;
			}
		}
	}

	return { start: section.start, end };
}

export function documentSectionChildren(
	document: Pick<WayfinderMarkdownDocument, "root" | "index">,
	title: string | string[],
	options: { depth?: Heading["depth"]; stopAtWayfinderMetadata?: boolean } = {},
): RootContent[] {
	const range = documentSectionRange(document, title, options);
	return range ? document.root.children.slice(range.start + 1, range.end) : [];
}

function isWayfinderMetadata(node: RootContent): boolean {
	return node.type === "html" && /^<!--\s*wayfinder:/i.test(node.value.trim());
}
