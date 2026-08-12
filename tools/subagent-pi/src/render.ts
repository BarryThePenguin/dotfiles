import * as os from "node:os";
import type { Message } from "@earendil-works/pi-ai";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getFinalOutput, isFailedResult } from "./run.ts";
import type { SubagentDetails } from "./details.ts";
import type { SingleResult } from "./types.ts";

const COLLAPSED_ITEM_COUNT = 10;

function formatTokens(count: number): string {
	if (count < 1000) {
		return count.toString();
	}
	if (count < 10000) {
		return `${(count / 1000).toFixed(1)}k`;
	}
	if (count < 1000000) {
		return `${Math.round(count / 1000)}k`;
	}
	return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) {
		parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	}
	if (usage.input) {
		parts.push(`↑${formatTokens(usage.input)}`);
	}
	if (usage.output) {
		parts.push(`↓${formatTokens(usage.output)}`);
	}
	if (usage.cacheRead) {
		parts.push(`R${formatTokens(usage.cacheRead)}`);
	}
	if (usage.cacheWrite) {
		parts.push(`W${formatTokens(usage.cacheWrite)}`);
	}
	if (usage.cost) {
		parts.push(`$${usage.cost.toFixed(4)}`);
	}
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) {
		parts.push(model);
	}
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args["command"] as string) || "...";
			const preview =
				command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args["file_path"] || args["path"] || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args["offset"] as number | undefined;
			const limit = args["limit"] as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg(
					"warning",
					`:${startLine}${endLine ? `-${endLine}` : ""}`,
				);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args["file_path"] || args["path"] || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args["content"] || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) {
				text += themeFg("dim", ` (${lines} lines)`);
			}
			return text;
		}
		case "edit": {
			const rawPath = (args["file_path"] || args["path"] || "...") as string;
			return (
				themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath))
			);
		}
		case "ls": {
			const rawPath = (args["path"] || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args["pattern"] || "*") as string;
			const rawPath = (args["path"] || ".") as string;
			return (
				themeFg("muted", "find ") +
				themeFg("accent", pattern) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		case "grep": {
			const pattern = (args["pattern"] || "") as string;
			const rawPath = (args["path"] || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview =
				argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

type DisplayItem =
	| { type: "text"; text: string }
	| { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") {
					items.push({ type: "text", text: part.text });
				} else if (part.type === "toolCall") {
					items.push({
						type: "toolCall",
						name: part.name,
						args: part.arguments,
					});
				}
			}
		}
	}
	return items;
}

interface Theme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

export function renderCall(
	args: {
		agent?: string;
		task?: string;
		tasks?: Array<{ agent: string; task: string }>;
	},
	theme: Theme,
	_context: unknown,
): Text {
	if (args.tasks && args.tasks.length > 0) {
		let text =
			theme.fg("toolTitle", theme.bold("subagent ")) +
			theme.fg("accent", `parallel (${args.tasks.length} tasks)`);
		for (const t of args.tasks.slice(0, 3)) {
			const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
			text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
		}
		if (args.tasks.length > 3) {
			text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
		}
		return new Text(text, 0, 0);
	}
	const agentName = args.agent || "...";
	const preview = args.task
		? args.task.length > 60
			? `${args.task.slice(0, 60)}...`
			: args.task
		: "...";
	let text =
		theme.fg("toolTitle", theme.bold("subagent ")) +
		theme.fg("accent", agentName);
	text += `\n  ${theme.fg("dim", preview)}`;
	return new Text(text, 0, 0);
}

export function renderResult(
	result: {
		content: Array<{ type: string; text?: string }>;
		details?: unknown;
	},
	{ expanded }: { expanded: boolean },
	theme: Theme,
	_context: unknown,
): Container | Text {
	const details = result.details as SubagentDetails | undefined;
	if (!details) {
		const text = result.content[0];
		return new Text(
			text?.type === "text" ? (text.text ?? "") : "(no output)",
			0,
			0,
		);
	}

	const mdTheme = getMarkdownTheme();

	const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
		const toShow = limit ? items.slice(-limit) : items;
		const skipped = limit && items.length > limit ? items.length - limit : 0;
		let text = "";
		if (skipped > 0) {
			text += theme.fg("muted", `... ${skipped} earlier items\n`);
		}
		for (const item of toShow) {
			if (item.type === "text") {
				const preview = expanded
					? item.text
					: item.text.split("\n").slice(0, 3).join("\n");
				text += `${theme.fg("toolOutput", preview)}\n`;
			} else {
				text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
			}
		}
		return text.trimEnd();
	};

	if (details.mode === "single" && details.results?.length === 1) {
		const r = details.results[0] as SingleResult;
		const isError = isFailedResult(r);
		const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
		const displayItems = getDisplayItems(r.messages);
		const finalOutput = getFinalOutput(r.messages);

		if (expanded) {
			const container = new Container();
			let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
			if (isError && r.stopReason) {
				header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
			}
			container.addChild(new Text(header, 0, 0));
			if (isError && r.errorMessage) {
				container.addChild(
					new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
				);
			}
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
			container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
			if (displayItems.length === 0 && !finalOutput) {
				container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
			} else {
				for (const item of displayItems) {
					if (item.type === "toolCall") {
						container.addChild(
							new Text(
								theme.fg("muted", "→ ") +
									formatToolCall(item.name, item.args, theme.fg.bind(theme)),
								0,
								0,
							),
						);
					}
				}
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}
			}
			const usageStr = formatUsageStats(r.usage, r.model);
			if (usageStr) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
			}
			return container;
		}

		let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
		if (isError && r.stopReason) {
			text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
		}
		if (isError && r.errorMessage) {
			text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
		} else if (displayItems.length === 0) {
			text += `\n${theme.fg("muted", "(no output)")}`;
		} else {
			text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
			if (displayItems.length > COLLAPSED_ITEM_COUNT) {
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
			}
		}
		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) {
			text += `\n${theme.fg("dim", usageStr)}`;
		}
		return new Text(text, 0, 0);
	}

	const aggregateUsage = (results: SingleResult[]) => {
		const total = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: 0,
		};
		for (const r of results) {
			total.input += r.usage.input;
			total.output += r.usage.output;
			total.cacheRead += r.usage.cacheRead;
			total.cacheWrite += r.usage.cacheWrite;
			total.cost += r.usage.cost;
			total.turns += r.usage.turns;
		}
		return total;
	};

	if (details.mode === "parallel" && details.snapshot) {
		const { entries, counts } = details.snapshot;
		const { queued, running, completed, failed, cancelled } = counts;
		const unfinished = queued + running;
		const settledResults = entries.flatMap((entry) =>
			entry.result ? [entry.result] : [],
		);
		const icon =
			unfinished > 0
				? theme.fg("warning", "⏳")
				: failed > 0 || cancelled > 0
					? theme.fg("warning", "◐")
					: theme.fg("success", "✓");
		const status =
			unfinished > 0
				? `${completed + failed + cancelled}/${entries.length} done, ${running} running${queued > 0 ? `, ${queued} queued` : ""}`
				: `${completed}/${entries.length} completed`;
		const statusIcon = (entry: (typeof entries)[number]) => {
			switch (entry.status) {
				case "queued":
					return theme.fg("muted", "…");
				case "running":
					return theme.fg("warning", "⏳");
				case "failed":
					return theme.fg("error", "✗");
				case "cancelled":
					return theme.fg("warning", "⊘");
				case "completed":
					return theme.fg("success", "✓");
			}
		};

		if (expanded && unfinished === 0) {
			const container = new Container();
			container.addChild(
				new Text(
					`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
					0,
					0,
				),
			);

			for (const entry of entries) {
				const result = entry.result;
				const rIcon = statusIcon(entry);
				const displayItems = result ? getDisplayItems(result.messages) : [];
				const finalOutput = result ? getFinalOutput(result.messages) : "";

				container.addChild(new Spacer(1));
				container.addChild(
					new Text(
						`${theme.fg("muted", "─── ") + theme.fg("accent", entry.task.agent)} ${rIcon} ${theme.fg("muted", `[${entry.status}]`)}`,
						0,
						0,
					),
				);
				container.addChild(
					new Text(
						theme.fg("muted", "Task: ") + theme.fg("dim", entry.task.task),
						0,
						0,
					),
				);

				for (const item of displayItems) {
					if (item.type === "toolCall") {
						container.addChild(
							new Text(
								theme.fg("muted", "→ ") +
									formatToolCall(item.name, item.args, theme.fg.bind(theme)),
								0,
								0,
							),
						);
					}
				}

				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
				}

				if (result) {
					const taskUsage = formatUsageStats(result.usage, result.model);
					if (taskUsage) {
						container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}
				} else if (entry.status === "cancelled") {
					container.addChild(new Text(theme.fg("muted", "(cancelled)"), 0, 0));
				}
			}

			const usageStr = formatUsageStats(aggregateUsage(settledResults));
			if (usageStr) {
				container.addChild(new Spacer(1));
				container.addChild(
					new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0),
				);
			}
			return container;
		}

		let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
		for (const entry of entries) {
			const result = entry.result;
			const displayItems = result ? getDisplayItems(result.messages) : [];
			text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", entry.task.agent)} ${statusIcon(entry)}`;
			if (displayItems.length === 0) {
				const emptyText =
					entry.status === "queued"
						? "(queued...)"
						: entry.status === "running"
							? "(running...)"
							: entry.status === "cancelled"
								? "(cancelled)"
								: "(no output)";
				text += `\n${theme.fg("muted", emptyText)}`;
			} else {
				text += `\n${renderDisplayItems(displayItems, 5)}`;
			}
		}
		if (unfinished === 0) {
			const usageStr = formatUsageStats(aggregateUsage(settledResults));
			if (usageStr) {
				text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
			}
		}
		if (!expanded) {
			text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		}
		return new Text(text, 0, 0);
	}

	const text = result.content[0];
	return new Text(
		text?.type === "text" ? (text.text ?? "") : "(no output)",
		0,
		0,
	);
}
