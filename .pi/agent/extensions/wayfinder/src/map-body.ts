/**
 * Wayfinder map body parser/compiler using remark and unist utilities.
 *
 * Map body sections: Destination, Notes, Decisions so far, Not yet specified, Out of scope.
 */

import type {
	Heading,
	ListItem,
	Paragraph,
	PhrasingContent,
	Root,
	RootContent,
} from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { u } from "unist-builder";
import { visit } from "unist-util-visit";
import { visitParents, type VisitorResult } from "unist-util-visit-parents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapSections {
	destination: string;
	notes: string;
	decisions: string;
	notYetSpecified: string;
	outOfScope: string;
}

const SECTION_HEADINGS: Record<keyof MapSections, string> = {
	destination: "destination",
	notes: "notes",
	decisions: "decisions so far",
	notYetSpecified: "not yet specified",
	outOfScope: "out of scope",
};

// ---------------------------------------------------------------------------
// Core AST helpers
// ---------------------------------------------------------------------------

const parse = (md: string): Root => unified().use(remarkParse).parse(md);

const stringify = (tree: Root): string =>
	unified().use(remarkStringify).stringify(tree).trim();

/** Build a {name → [start, end)} range map over tree.children, keyed by lowercased heading text. */
function findSectionRanges(
	tree: Root,
): Map<string, { start: number; end: number }> {
	const ranges = new Map<string, { start: number; end: number }>();
	const headingIndices: number[] = [];
	tree.children.forEach((child, i) => {
		if (child.type === "heading") {
			headingIndices.push(i);
		}
	});
	tree.children.forEach((child, i) => {
		if (child.type !== "heading") {
			return;
		}
		const pos = headingIndices.indexOf(i);
		const end = headingIndices[pos + 1] ?? tree.children.length;
		ranges.set(toString(child).toLowerCase().trim(), { start: i, end });
	});
	return ranges;
}

/** Top-level nodes in a named section, or [] if absent. */
function getSectionNodes(tree: Root, name: string): RootContent[] {
	const r = findSectionRanges(tree).get(name.toLowerCase());
	if (!r) {
		return [];
	}
	return tree.children.slice(r.start + 1, r.end);
}

/** Replace the content of a named section by splicing the tree in place. */
function setSectionNodes(
	tree: Root,
	name: string,
	newNodes: RootContent[],
): void {
	const r = findSectionRanges(tree).get(name.toLowerCase());
	if (!r) {
		return;
	}
	tree.children.splice(r.start + 1, r.end - r.start - 1, ...newNodes);
}

/** Stringify MDAST nodes back to markdown. */
const toMd = (nodes: RootContent[]): string =>
	nodes.length ? toMarkdown(u("root", nodes)).trim() : "";

/** Find list items recursively (drills into nested lists and listItems). */
function findListItems(nodes: RootContent[]): ListItem[] {
	const items: ListItem[] = [];
	visit(u("root", nodes), "listItem", (node) => {
		items.push(node);
	});
	return items;
}

const heading = (depth: Heading["depth"], text: string): Heading =>
	u("heading", { depth }, [u("text", text)]);

const paragraph = (...children: PhrasingContent[]): Paragraph =>
	u("paragraph", children);

const listItem = (...children: PhrasingContent[]): ListItem =>
	u("listItem", [paragraph(...children)]);

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** Parse a wayfinder map body into its five sections. */
export function parseMapBody(body: string): MapSections {
	const tree = parse(body);
	const sections = {} as MapSections;
	for (const [key, name] of Object.entries(SECTION_HEADINGS)) {
		sections[key as keyof MapSections] = toMd(getSectionNodes(tree, name));
	}
	return sections;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const textToNodes = (text: string): RootContent[] =>
	text.trim() ? parse(text).children : [];

/** Build a fresh map body from raw section strings. */
export function buildMapBody(sections: MapSections): string {
	const root = u(
		"root",
		Object.entries(SECTION_HEADINGS).flatMap(([key, name]) => [
			heading(2, name),
			...textToNodes(sections[key as keyof MapSections]),
		]),
	) as Root;
	return stringify(root);
}

/** Build the initial map body for a new effort. */
export function buildInitialMapBody(destination: string, notes = ""): string {
	return buildMapBody({
		destination,
		notes,
		decisions: "",
		notYetSpecified: "",
		outOfScope: "",
	});
}

// ---------------------------------------------------------------------------
// Update helpers
// ---------------------------------------------------------------------------

/** Replace the content of a named section. */
export function replaceSection(
	body: string,
	heading: string,
	newContent: string,
): string {
	const tree = parse(body);
	setSectionNodes(tree, heading, parse(`\n${newContent}\n`).children);
	return stringify(tree);
}

/** Append a listItem to a named section after its existing content. */
function appendListItem(
	tree: Root,
	sectionName: string,
	entry: ListItem,
): void {
	const existing = getSectionNodes(tree, sectionName);
	setSectionNodes(tree, sectionName, [...existing, entry]);
}

/** Append a decision entry to the "Decisions so far" section. */
export function appendDecision(
	body: string,
	ticketTitle: string,
	ticketUrl: string,
	gist: string,
): string {
	const tree = parse(body);
	const entry = listItem(
		u("link", { url: ticketUrl }, [u("text", ticketTitle)]),
		u("text", ` — ${gist}`),
	);
	appendListItem(tree, SECTION_HEADINGS.decisions, entry);
	return stringify(tree);
}

/** Append a fog item to "Not yet specified". */
export function addFogItem(body: string, item: string): string {
	const tree = parse(body);
	appendListItem(
		tree,
		SECTION_HEADINGS.notYetSpecified,
		listItem(u("text", item)),
	);
	return stringify(tree);
}

/** Remove a fog item by index (counted across all list items, including nested). */
export function removeFogItem(body: string, index: number): string {
	const tree = parse(body);
	const sectionNodes = getSectionNodes(tree, SECTION_HEADINGS.notYetSpecified);
	if (sectionNodes.length === 0) {
		return stringify(tree);
	}

	let current = 0;
	let stop: VisitorResult = undefined;
	visitParents(u("root", sectionNodes), "listItem", (node, parents) => {
		if (stop !== undefined) {
			return stop;
		}
		if (current === index) {
			const list = parents[parents.length - 1] as { children: RootContent[] };
			const idx = list.children.indexOf(node);
			if (idx >= 0) {
				list.children.splice(idx, 1);
			}
			stop = false;
			return stop;
		}
		current++;
		return undefined;
	});

	return stringify(tree);
}

/** Add an out-of-scope item. */
export function addOutOfScope(
	body: string,
	gist: string,
	ticketUrl?: string,
): string {
	const tree = parse(body);
	const parts: PhrasingContent[] = ticketUrl
		? [
				u("link", { url: ticketUrl }, [u("text", "Out of scope ticket")]),
				u("text", " — "),
				u("text", gist),
			]
		: [u("text", gist)];
	appendListItem(tree, SECTION_HEADINGS.outOfScope, listItem(...parts));
	return stringify(tree);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Count items in a section (includes nested list items). */
export function countSectionItems(
	body: string,
	section: keyof MapSections,
): number {
	return findListItems(getSectionNodes(parse(body), SECTION_HEADINGS[section]))
		.length;
}

/** List fog items as strings. */
export function listFogItems(body: string): string[] {
	return findListItems(
		getSectionNodes(parse(body), SECTION_HEADINGS.notYetSpecified),
	).map((item) => toString(item).trim());
}
