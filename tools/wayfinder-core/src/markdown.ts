import type { Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";

const processor = unified()
	.use(remarkParse)
	.use(remarkStringify, {
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
