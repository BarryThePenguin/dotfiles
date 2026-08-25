/**
 * Claude adapter shim for the Wayfinder/Issue action surface.
 *
 * Handler bodies live in issue-tools-core. This file wires the Claude MCP
 * host context (ClaudeSession) into an ActionRuntime<ActionResult> and
 * delegates to the shared handleAction.
 */

import { createActionHandler, type ActionMap } from "issue-tools-core";
import type { ClaudeSession } from "./session.ts";

export type { ActionMap };

export type ActionResult = {
	content: { type: "text"; text: string }[];
};

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	session: ClaudeSession,
): Promise<ActionResult> {
	const handler = createActionHandler<ActionResult>(session, {
		success: (text) => ({ content: [{ type: "text", text }] }),
		error: (message) => ({
			content: [{ type: "text", text: `Error: ${message}` }],
		}),
	});

	return handler(action, params);
}
