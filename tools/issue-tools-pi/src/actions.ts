/**
 * Pi adapter shim for the Wayfinder/Issue action surface.
 *
 * Handler bodies live in issue-tools-core. This file wires the Pi host context
 * (TrackerSession) into an ActionRuntime<ActionResult> and delegates to the
 * shared handleAction.
 */

import {
	createSessionRuntime,
	handleAction as coreHandleAction,
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

export interface ToolContext {
	trackerSession: TrackerSession;
}

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	ctx: ToolContext,
): Promise<ActionResult> {
	return createSessionRuntime(ctx.trackerSession, {
		success: (text): ActionResult => ({
			content: [{ type: "text", text }],
			details: undefined,
		}),
		error: (message): ActionResult => ({
			content: [{ type: "text", text: `Error: ${message}` }],
			details: undefined,
		}),
	}).then((runtime) => coreHandleAction(action, params, runtime));
}
