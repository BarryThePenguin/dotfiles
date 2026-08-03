import type {
	BlockContent,
	Blockquote,
	DefinitionContent,
	Heading,
	Link,
	List,
	ListContent,
	ListItem,
	Paragraph,
	PhrasingContent,
	Root,
	RootContent,
	Strong,
	Text,
} from "mdast";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { u } from "unist-builder";
import { visit } from "unist-util-visit";

const processor = unified().use(remarkParse).use(remarkStringify, {
	bullet: "-",
	fences: true,
	listItemIndent: "one",
});

export function parseMarkdown(markdown: string): Root {
	return processor.parse(markdown);
}

export function stringifyMarkdown(root: Root): string {
	return processor.stringify(root);
}

export function stringifyChildren(children: RootContent[]): string {
	return stringifyMarkdown({ type: "root", children }).trim();
}

export function markdownBlocks(markdown: string): RootContent[] {
	return markdown ? parseMarkdown(markdown.trim()).children : [];
}

export function markdownBlockGroups(markdown: string[]): RootContent[] {
	return markdown.flatMap((value) => markdownBlocks(value));
}

export function listItems(children: RootContent[]): ListItem[] {
	const items: ListItem[] = [];
	visit({ type: "root", children }, "listItem", (node) => {
		items.push(node);
	});
	return items;
}

export function listItemTexts(children: RootContent[]): string[] {
	return listItems(children)
		.map((item) => toString(item).trim())
		.filter((item) => item.length > 0);
}

export function text(value: string): Text {
	return u("text", value);
}

export function strong(children: PhrasingContent[]): Strong {
	return u("strong", { children });
}

export function paragraph(value: string | PhrasingContent[]): Paragraph {
	return u("paragraph", {
		children: typeof value === "string" ? [text(value)] : value,
	});
}

export function blockquote(value: string | BlockContent[]): Blockquote {
	return u("blockquote", {
		children: typeof value === "string" ? [paragraph(value)] : value,
	});
}

export function link(url: string, children: PhrasingContent[]): Link {
	return u("link", { url, children });
}

export function listItem(
	children: Array<BlockContent | DefinitionContent>,
): ListItem {
	return u("listItem", {
		type: "listItem",
		spread: false,
		checked: null,
		children,
	});
}

export function list(children: ListContent[]): List {
	return u("list", { ordered: false, spread: false, children });
}

export function heading(
	depth: Heading["depth"] = 2,
	children: PhrasingContent[],
): Heading {
	return u("heading", { depth }, children);
}
