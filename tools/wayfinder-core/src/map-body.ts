import type {
	Heading,
	Link,
	List,
	ListItem,
	Paragraph,
	Root,
	RootContent,
	Text,
} from "mdast";
import { toString } from "mdast-util-to-string";
import { u } from "unist-builder";
import {
	parseMarkdown,
	stringifyChildren,
	stringifyMarkdown,
} from "./markdown.ts";
import type {
	DecisionSummary,
	OutOfScopeEntry,
	ParsedMapBody,
	RenderMapBodyInput,
} from "./schema.ts";

const SECTION_TITLES = [
	"Destination",
	"Notes",
	"Decisions so far",
	"Not yet specified",
	"Out of scope",
] as const;

type SectionTitle = (typeof SECTION_TITLES)[number];

export type MapSectionKey =
	"destination" | "notes" | "decisions" | "notYetSpecified" | "outOfScope";

const SECTION_KEY_TO_TITLE = {
	destination: "Destination",
	notes: "Notes",
	decisions: "Decisions so far",
	notYetSpecified: "Not yet specified",
	outOfScope: "Out of scope",
} as const satisfies Record<MapSectionKey, SectionTitle>;

function heading(value: SectionTitle): Heading {
	return u("heading", { depth: 2 }, [text(value)]) as Heading;
}

function paragraph(value: string): Paragraph {
	return u("paragraph", [text(value)]);
}

function text(value: string): Text {
	return u("text", value);
}

function link(title: string, url: string): Link {
	return u("link", { url }, [text(title)]);
}

function list(items: ListItem[]): List {
	return u("list", { ordered: false, spread: false }, items);
}

function listItem(children: Paragraph["children"]): ListItem {
	return u("listItem", { spread: false, checked: null }, [
		u("paragraph", children),
	]);
}

function sectionKey(title: string): SectionTitle | undefined {
	return SECTION_TITLES.find(
		(sectionTitle) => sectionTitle.toLowerCase() === title.toLowerCase(),
	);
}

function splitSections(root: Root): Map<SectionTitle, RootContent[]> {
	const sections = new Map<SectionTitle, RootContent[]>();
	let current: SectionTitle | undefined;

	for (const node of root.children) {
		if (node.type === "heading" && node.depth === 2) {
			current = sectionKey(toString(node).trim());
			if (current && !sections.has(current)) {
				sections.set(current, []);
			}
			continue;
		}

		if (current) {
			sections.get(current)?.push(node);
		}
	}

	return sections;
}

function sectionRange(
	root: Root,
	title: SectionTitle,
): { start: number; end: number } | undefined {
	let start: number | undefined;
	for (const [index, node] of root.children.entries()) {
		if (node.type !== "heading" || node.depth !== 2) {
			continue;
		}

		if (start !== undefined) {
			return { start, end: index };
		}

		if (sectionKey(toString(node).trim()) === title) {
			start = index;
		}
	}

	return start === undefined ? undefined : { start, end: root.children.length };
}

function plainSection(
	sections: Map<SectionTitle, RootContent[]>,
	title: SectionTitle,
) {
	return stringifyChildren(sections.get(title) ?? []).trim();
}

function parseStringList(nodes: RootContent[]): string[] {
	const [firstNode] = nodes;
	if (firstNode?.type === "list") {
		return firstNode.children
			.map((item) => toString(item).trim())
			.filter((item) => item.length > 0);
	}

	return stringifyChildren(nodes)
		.split("\n")
		.map((line) => line.replace(/^-\s+/, "").trim())
		.filter((line) => line.length > 0);
}

function firstParagraph(item: ListItem): Paragraph | undefined {
	return item.children.find((child) => child.type === "paragraph");
}

function parseDecisions(nodes: RootContent[]): DecisionSummary[] {
	const [firstNode] = nodes;
	if (firstNode?.type !== "list") {
		return [];
	}

	return firstNode.children.flatMap((item) => {
		const paragraphNode = firstParagraph(item);
		const firstChild = paragraphNode?.children[0];
		if (!paragraphNode || firstChild?.type !== "link") {
			return [];
		}

		const rest = paragraphNode.children
			.slice(1)
			.map((child) => toString(child))
			.join("")
			.replace(/^\s*—\s*/, "")
			.trim();

		return [
			{
				title: toString(firstChild).trim(),
				url: firstChild.url,
				gist: rest,
			},
		];
	});
}

function parseOutOfScope(nodes: RootContent[]): OutOfScopeEntry[] {
	const [firstNode] = nodes;
	if (firstNode?.type !== "list") {
		return [];
	}

	return firstNode.children.flatMap((item) => {
		const paragraphNode = firstParagraph(item);
		if (!paragraphNode) {
			return [];
		}

		const firstChild = paragraphNode.children[0];
		if (firstChild?.type === "link") {
			const reason = paragraphNode.children
				.slice(1)
				.map((child) => toString(child))
				.join("")
				.replace(/^\s*—\s*/, "")
				.trim();
			return [
				{
					text: toString(firstChild).trim(),
					reason,
					url: firstChild.url,
				},
			];
		}

		const line = toString(paragraphNode).trim();
		const [entryText = "", reason = ""] = line.split(/\s+—\s+/, 2);
		return [{ text: entryText.trim(), reason: reason.trim() }];
	});
}

function mapBodyRoot(input: RenderMapBodyInput): Root {
	const children: RootContent[] = [];

	children.push(heading("Destination"));
	if (input.destination) {
		children.push(paragraph(input.destination));
	}

	children.push(heading("Notes"));
	if (input.notes) {
		children.push(paragraph(input.notes));
	}

	children.push(heading("Decisions so far"));
	if (input.decisionsSoFar.length > 0) {
		children.push(
			list(
				input.decisionsSoFar.map((decision) =>
					listItem([
						link(decision.title, decision.url),
						text(` — ${decision.gist}`),
					]),
				),
			),
		);
	}

	children.push(heading("Not yet specified"));
	if (input.notYetSpecified.length > 0) {
		children.push(
			list(input.notYetSpecified.map((item) => listItem([text(item)]))),
		);
	}

	children.push(heading("Out of scope"));
	if (input.outOfScope.length > 0) {
		children.push(
			list(
				input.outOfScope.map((entry) => {
					const prefix = entry.url
						? link(entry.text, entry.url)
						: text(entry.text);
					return listItem([prefix, text(` — ${entry.reason}`)]);
				}),
			),
		);
	}

	return u("root", children);
}

export function renderMapBody(input: RenderMapBodyInput): string {
	return stringifyMarkdown(mapBodyRoot(input));
}

export function parseMapBody(markdown: string): ParsedMapBody {
	const sections = splitSections(parseMarkdown(markdown));
	return {
		destination: plainSection(sections, "Destination"),
		notes: plainSection(sections, "Notes"),
		decisionsSoFar: parseDecisions(sections.get("Decisions so far") ?? []),
		notYetSpecified: parseStringList(sections.get("Not yet specified") ?? []),
		outOfScope: parseOutOfScope(sections.get("Out of scope") ?? []),
	};
}

export function appendDecision(
	markdown: string,
	decision: DecisionSummary,
): string {
	const parsed = parseMapBody(markdown);
	return renderMapBody({
		...parsed,
		decisionsSoFar: [...parsed.decisionsSoFar, decision],
	});
}

export function replaceMapSection(
	markdown: string,
	section: MapSectionKey,
	content: string,
): string {
	const root = parseMarkdown(markdown);
	const title = SECTION_KEY_TO_TITLE[section];
	const nextNodes = parseMarkdown(content).children;
	const range = sectionRange(root, title);
	if (!range) {
		root.children.push(heading(title), ...nextNodes);
		return stringifyMarkdown(root);
	}

	root.children.splice(
		range.start + 1,
		range.end - range.start - 1,
		...nextNodes,
	);
	return stringifyMarkdown(root);
}

export function appendOutOfScope(
	markdown: string,
	entry: OutOfScopeEntry,
): string {
	const parsed = parseMapBody(markdown);
	return renderMapBody({
		...parsed,
		outOfScope: [...parsed.outOfScope, entry],
	});
}
