import type { Html, Root, RootContent } from "mdast";
import { u } from "unist-builder";
import { visit } from "unist-util-visit";
import { parseMarkdown, stringifyMarkdown } from "./markdown.ts";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metadataPattern(key: string): RegExp {
	return new RegExp(
		`^<!--\\s*wayfinder:${escapeRegExp(key)}:?(?:\\s+([\\s\\S]*?))?\\s*-->$`,
	);
}

function metadataNode(key: string, value: string): Html {
	return u("html", `<!-- wayfinder:${key} ${value} -->`);
}

function readMetadataValue(node: RootContent, key: string): string | undefined {
	if (node.type !== "html") {
		return undefined;
	}
	const match = metadataPattern(key).exec(node.value.trim());
	if (!match) {
		return undefined;
	}
	return match[1]?.trim() ?? "";
}

function isMetadataNode(node: RootContent, key: string): boolean {
	return readMetadataValue(node, key) !== undefined;
}

export function getMetadataFromRoot(root: Root, key: string): string[] {
	const values: string[] = [];
	visit(root, "html", (node: Html) => {
		const value = readMetadataValue(node, key);
		if (value !== undefined) {
			values.push(value);
		}
	});
	return values;
}

export function getMetadata(markdown: string, key: string): string[] {
	return getMetadataFromRoot(parseMarkdown(markdown), key);
}

export function appendMetadataToRoot(
	root: Root,
	key: string,
	value: string,
): void {
	root.children.push(metadataNode(key, value));
}

export function appendMetadata(
	markdown: string,
	key: string,
	value: string,
): string {
	const root = parseMarkdown(markdown);
	appendMetadataToRoot(root, key, value);
	return stringifyMarkdown(root);
}

export function setMetadataOnRoot(
	root: Root,
	key: string,
	values: string[],
): void {
	root.children = root.children.filter((node) => !isMetadataNode(node, key));
	root.children.push(...values.map((value) => metadataNode(key, value)));
}

export function setMetadata(
	markdown: string,
	key: string,
	values: string[],
): string {
	const root = parseMarkdown(markdown);
	setMetadataOnRoot(root, key, values);
	return stringifyMarkdown(root);
}

export function removeMetadataFromRoot(root: Root, key: string): void {
	root.children = root.children.filter((node) => !isMetadataNode(node, key));
}

export function removeMetadata(markdown: string, key: string): string {
	const root = parseMarkdown(markdown);
	removeMetadataFromRoot(root, key);
	return stringifyMarkdown(root);
}
