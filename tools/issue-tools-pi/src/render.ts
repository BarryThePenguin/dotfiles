/**
 * Wayfinder tool rendering.
 */

import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ActionMap } from "./actions.ts";

type RenderCallArgs = {
	title?: string;
	ticket_id?: string;
	type?: string;
	section?: string;
	map_id?: string;
	id?: string;
};

export function renderCall(
	action: keyof ActionMap,
	args: RenderCallArgs,
	theme: Theme,
): Text {
	const isIssueAction = action === "issue_create" || action === "issue_read";
	const label = isIssueAction ? "issue" : "wayfinder";
	let text = theme.fg("toolTitle", theme.bold(`${label} `)) +
		theme.fg("accent", action);
	if (args.title) {
		text += ` ${theme.fg("dim", `"${args.title}"`)}`;
	}
	if (args.ticket_id) {
		text += ` ${theme.fg("muted", args.ticket_id)}`;
	}
	if (args.id) {
		text += ` ${theme.fg("muted", args.id)}`;
	}
	if (args.type) {
		text += ` ${theme.fg("muted", `[${args.type}]`)}`;
	}
	if (args.section) {
		text += ` ${theme.fg("muted", args.section)}`;
	}
	return new Text(text, 0, 0);
}

type RenderDetails = unknown;

export function renderResult(
	result: AgentToolResult<RenderDetails>,
	{ expanded }: { expanded: boolean },
	theme: Theme,
): Text {
	const first = result.content[0];
	const content = first && first.type === "text" ? first.text : "";
	if (expanded || !content) {
		return new Text(content, 0, 0);
	}
	const lines = content.split("\n");
	return new Text(
		lines.slice(0, 4).join("\n") +
			(lines.length > 4 ? `\n${theme.fg("dim", "...")}` : ""),
		0,
		0,
	);
}
