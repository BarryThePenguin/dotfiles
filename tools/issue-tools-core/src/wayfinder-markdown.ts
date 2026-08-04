import type { Heading, Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import {
	heading,
	paragraph,
	parseMarkdown,
	stringifyMarkdown,
	text,
} from "./markdown.ts";

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
	localHeaders: WayfinderMarkdownHeader[];
};

/**
 * The Wayfinder Markdown document: the single read/mutate/render surface for
 * every format in this package (map body, ticket body, local file envelope,
 * generic issue envelope). One parse builds the index; mutations keep it
 * fresh by re-indexing. Builders compose raw roots and wrap them here; nobody
 * mutates a root behind the document's back.
 */
export type WayfinderMarkdownDocument = {
	root: Root;
	index: WayfinderMarkdownIndex;
	title: () => string | undefined;
	section: (
		title: string | string[],
		options?: { depth?: Heading["depth"] },
	) => RootContent[];
	header: (name: string) => string | undefined;
	setHeader: (name: string, value: string | undefined) => void;
	setSection: (
		title: string,
		children: RootContent[],
		options?: { depth?: Heading["depth"] },
	) => void;
	removeSection: (
		title: string | string[],
		options?: { depth?: Heading["depth"] },
	) => void;
	stringify: () => string;
};

function normalizeSectionTitle(title: string): string {
	return title.trim().replace(/:$/, "").toLowerCase();
}

function headerParagraphIndex(root: Root): number | undefined {
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

function headerLines(root: Root): string[] {
	const index = headerParagraphIndex(root);
	if (index === undefined) {
		return [];
	}
	return toString(root.children[index] ?? { type: "text", value: "" }).split(
		"\n",
	);
}

function headerEntries(root: Root): WayfinderMarkdownHeader[] {
	return headerLines(root).flatMap((line) => {
		const match = /^([A-Za-z][A-Za-z ]*):\s*([\s\S]*)$/.exec(line.trim());
		return match?.[1]
			? [{ name: match[1], value: match[2]?.trim() ?? "" }]
			: [];
	});
}

function setHeaderOnRoot(
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
		const firstSectionIndex = root.children.findIndex(
			(node) => node.type === "heading" && node.depth >= 2,
		);
		const insertAt =
			firstSectionIndex === -1 ? root.children.length : firstSectionIndex;
		root.children.splice(insertAt, 0, paragraph(lines.join("\n")));
	}
}

function indexWayfinderMarkdown(root: Root): WayfinderMarkdownIndex {
	const sections: WayfinderMarkdownSection[] = [];
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
		localHeaders: headerEntries(root),
	};
}

function documentSectionRange(
	document: Pick<WayfinderMarkdownDocument, "root" | "index">,
	title: string | string[],
	options: { depth?: Heading["depth"] } = {},
): { start: number; end: number } | undefined {
	const depth = options.depth ?? 2;
	const expectedTitles = Array.isArray(title) ? title : [title];
	const normalizedTitles = new Set(expectedTitles.map(normalizeSectionTitle));
	const section = document.index.sections.find(
		(candidate) =>
			candidate.depth === depth &&
			normalizedTitles.has(candidate.normalizedTitle),
	);
	return section ? { start: section.start, end: section.end } : undefined;
}

function documentSectionChildren(
	document: Pick<WayfinderMarkdownDocument, "root" | "index">,
	title: string | string[],
	options: { depth?: Heading["depth"] } = {},
): RootContent[] {
	const range = documentSectionRange(document, title, options);
	return range ? document.root.children.slice(range.start + 1, range.end) : [];
}

function removeSectionOnRoot(
	document: Pick<WayfinderMarkdownDocument, "root" | "index">,
	title: string | string[],
	options: { depth?: Heading["depth"] } = {},
): void {
	const range = documentSectionRange(document, title, options);
	if (!range) {
		return;
	}
	document.root.children.splice(range.start, range.end - range.start);
}

function replaceSectionOnRoot(
	document: Pick<WayfinderMarkdownDocument, "root" | "index">,
	title: string,
	children: RootContent[],
	options: { depth?: Heading["depth"] } = {},
): void {
	const depth: Heading["depth"] = options.depth ?? 2;
	const range = documentSectionRange(document, title, options);
	if (!range) {
		document.root.children.push(heading(depth, [text(title)]), ...children);
		return;
	}
	document.root.children.splice(
		range.start,
		range.end - range.start,
		heading(depth, [text(title)]),
		...children,
	);
}

export function markdownDocumentFromRoot(
	root: Root,
): WayfinderMarkdownDocument {
	let index = indexWayfinderMarkdown(root);
	const refresh = () => {
		index = indexWayfinderMarkdown(root);
	};

	return {
		root,
		get index() {
			return index;
		},
		title: () => index.title,
		section: (title, options) =>
			documentSectionChildren({ root, index }, title, options),
		header: (name) =>
			index.localHeaders.find(
				(header) => header.name.toLowerCase() === name.toLowerCase(),
			)?.value,
		setHeader(name, value) {
			setHeaderOnRoot(root, name, value);
			refresh();
		},
		setSection(title, children, options) {
			replaceSectionOnRoot({ root, index }, title, children, options);
			refresh();
		},
		removeSection(title, options) {
			removeSectionOnRoot({ root, index }, title, options);
			refresh();
		},
		stringify: () => stringifyMarkdown(root),
	};
}

export function markdownDocument(markdown: string): WayfinderMarkdownDocument {
	return markdownDocumentFromRoot(parseMarkdown(markdown));
}
