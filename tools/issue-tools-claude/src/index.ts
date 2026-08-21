#!/usr/bin/env node

import {
	McpServer,
	fromJsonSchema,
	type JsonSchemaType,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
	detectTrackerSelection,
	handleAction,
	toolCatalog,
	type ActionMap,
} from "issue-tools-core";
import { createSessionRuntime } from "issue-tools-core";
import { createClaudeSession } from "./session.ts";

const session = createClaudeSession(process.cwd());
const mcp = new McpServer({ name: "issue-tools", version: "0.1.0" });

for (const tool of toolCatalog) {
	mcp.registerTool(
		tool.name,
		{
			description: tool.description,
			inputSchema: fromJsonSchema(tool.params as JsonSchemaType),
		},
		async (args) => {
			const runtime = await createSessionRuntime(session, {
				success: (text) => ({ content: [{ type: "text" as const, text }] }),
				error: (message) => ({
					content: [{ type: "text" as const, text: `Error: ${message}` }],
				}),
			});
			return handleAction(
				tool.action,
				args as ActionMap[keyof ActionMap],
				runtime,
			);
		},
	);
}

mcp.registerTool(
	"issue_tracker_setup",
	{
		description:
			"Configure which Issue tracker this session uses — local Markdown (.scratch) or Todoist. Without a tracker arg, reports the current detection.",
		inputSchema: fromJsonSchema({
			type: "object",
			properties: {
				tracker: {
					type: "string",
					enum: ["local", "todoist", "auto"],
					description:
						"Force tracker mode ('auto' clears a previous override and re-detects)",
				},
			},
		}),
	},
	(args) => {
		const { tracker } = args as {
			tracker?: "local" | "todoist" | "auto";
		};
		if (tracker) {
			session.setTrackerMode(tracker);
			const mode =
				tracker === "auto" ? "auto (re-detected on next use)" : tracker;
			return { content: [{ type: "text", text: `Tracker mode: ${mode}.` }] };
		}
		const selection = detectTrackerSelection(process.cwd());
		if (selection === "neither") {
			return {
				content: [
					{
						type: "text",
						text: "No tracker configured. Create a .scratch/ directory for local mode, or run `doist projects add` to configure Todoist.",
					},
				],
			};
		}
		if (selection === "both") {
			return {
				content: [
					{
						type: "text",
						text: "Both .scratch and .doistrc are present. Defaulting to local. Re-run with tracker: 'todoist' to force Todoist.",
					},
				],
			};
		}
		return {
			content: [{ type: "text", text: `Detected tracker: ${selection}.` }],
		};
	},
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
