/**
 * Pi adapter shim for the Wayfinder/Issue action surface.
 *
 * Handler bodies live in issue-tools-core. This file wires the Pi host context
 * (TrackerSession) into an ActionRuntime<ActionResult> and delegates to the
 * shared handleAction.
 */

import {
	createActionHandler,
	type ActionMap,
	type TrackerSession,
} from "issue-tools-core";

export type { ActionMap };

/**
 * Matches pi's AgentToolResult shape, which requires a `details` field for
 * UI rendering. The action surface carries no structured details today.
 */
export type ActionResult = {
	content: { type: "text"; text: string }[];
	details: undefined;
};

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	trackerSession: TrackerSession,
): Promise<ActionResult> {
	const handler = createActionHandler<ActionResult>(trackerSession, {
		success: (text) => ({
			content: [{ type: "text", text }],
			details: undefined,
		}),
		error: (message) => ({
			content: [{ type: "text", text: `Error: ${message}` }],
			details: undefined,
		}),
	});

	return handler(action, params);
}
