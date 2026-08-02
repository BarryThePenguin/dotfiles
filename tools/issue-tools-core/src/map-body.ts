import type { ListItem, Paragraph, Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";
import { u } from "unist-builder";
import {
	listItems,
	listItemTexts,
	heading,
	link,
	list,
	listItem,
	markdownBlocks,
	text,
	parseMarkdown,
	replaceSection,
	stringifyChildren,
	stringifyMarkdown,
	paragraph,
} from "./markdown.ts";
import {
	markdownDocument,
	type WayfinderMarkdownDocument,
} from "./wayfinder-markdown.ts";
import type {
	DecisionSummary,
	MapSection,
	OutOfScopeEntry,
	ParsedMapBody,
	RenderMapBodyInput,
} from "./schema.ts";

type SectionTitle =
	| "Destination"
	| "Notes"
	| "Decisions so far"
	| "Not yet specified"
	| "Out of scope";

export type MapSectionKey = MapSection;

const SECTION_KEY_TO_TITLE = {
	destination: "Destination",
	notes: "Notes",
	decisions: "Decisions so far",
	notYetSpecified: "Not yet specified",
	outOfScope: "Out of scope",
} as const satisfies Record<MapSectionKey, SectionTitle>;

function plainSection(document: WayfinderMarkdownDocument, title: SectionTitle) {
	return stringifyChildren(document.section(title)).trim();
}

function parseStringList(nodes: RootContent[]): string[] {
	const items = listItemTexts(nodes);
	if (items.length > 0) {
		return items;
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
	return listItems(nodes).flatMap((item) => {
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
	return listItems(nodes).flatMap((item) => {
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

export type MapBodyRootInput = Omit<
	RenderMapBodyInput,
	"destination" | "notes"
> & {
	destination: RootContent[];
	notes: RootContent[];
};

export function mapBodyRoot(input: MapBodyRootInput): Root {
	const children: RootContent[] = [];

	children.push(heading(2, [text("Destination")]));
	children.push(...input.destination);

	children.push(heading(2, [text("Notes")]));
	children.push(...input.notes);

	children.push(heading(2, [text("Decisions so far")]));
	if (input.decisionsSoFar.length > 0) {
		children.push(
			list(
				input.decisionsSoFar.map((decision) =>
					listItem([
						paragraph([
							link(decision.url, [text(decision.title)]),
							text(` — ${decision.gist}`),
						]),
					]),
				),
			),
		);
	}

	children.push(heading(2, [text("Not yet specified")]));
	if (input.notYetSpecified.length > 0) {
		children.push(
			list(
				input.notYetSpecified.map((item) => listItem([paragraph([text(item)])])),
			),
		);
	}

	children.push(heading(2, [text("Out of scope")]));
	if (input.outOfScope.length > 0) {
		children.push(
			list(
				input.outOfScope.map((entry) => {
					const prefix = entry.url
						? link(entry.url, [text(entry.text)])
						: text(entry.text);
					return listItem([paragraph([prefix, text(` — ${entry.reason}`)])]);
				}),
			),
		);
	}

	return u("root", children);
}

export function renderMapBody(input: RenderMapBodyInput): string {
	return stringifyMarkdown(
		mapBodyRoot({
			...input,
			destination: markdownBlocks(input.destination),
			notes: markdownBlocks(input.notes),
		}),
	);
}

export function mapBodyFromDocument(
	document: WayfinderMarkdownDocument,
): ParsedMapBody {
	return {
		destination: plainSection(document, "Destination"),
		notes: plainSection(document, "Notes"),
		decisionsSoFar: parseDecisions(document.section("Decisions so far")),
		notYetSpecified: parseStringList(document.section("Not yet specified")),
		outOfScope: parseOutOfScope(document.section("Out of scope")),
	};
}

export function parseMapBody(markdown: string): ParsedMapBody {
	return mapBodyFromDocument(markdownDocument(markdown));
}

export function appendDecision(
	markdown: string,
	decision: DecisionSummary,
): string {
	const parsed = parseMapBody(markdown);
	if (parsed.decisionsSoFar.some((existing) => existing.url === decision.url)) {
		return markdown;
	}

	return renderMapBody({
		...parsed,
		decisionsSoFar: [...parsed.decisionsSoFar, decision],
	});
}

export function replaceMapSectionOnRoot(
	root: Root,
	section: MapSectionKey,
	content: RootContent[],
): void {
	replaceSection(root, SECTION_KEY_TO_TITLE[section], content);
}

export function replaceMapSection(
	markdown: string,
	section: MapSectionKey,
	content: string,
): string {
	const root = parseMarkdown(markdown);
	replaceMapSectionOnRoot(root, section, markdownBlocks(content));
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
