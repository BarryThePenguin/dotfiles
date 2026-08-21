/**
 * OpenCode adapter shim for the Wayfinder/Issue action surface.
 *
 * Handler bodies live in issue-tools-core. This file wires the OpenCode host
 * context into an ActionRuntime<ActionResult> and delegates to handleAction.
 */

import {
	createSessionRuntime,
	handleAction as coreHandleAction,
	type ActionMap,
} from "issue-tools-core";
import type { OpenCodeSession } from "./tracker.ts";

export type { ActionMap };

export type ActionResult = {
	output: string;
	metadata: Record<string, unknown>;
};

export interface ToolContext {
	session: OpenCodeSession;
}

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	ctx: ToolContext,
): Promise<ActionResult> {
	return createSessionRuntime(ctx.session, {
		success: (text, metadata): ActionResult => ({ output: text, metadata }),
		error: (message): ActionResult => ({
			output: `Error: ${message}`,
			metadata: {},
		}),
	}).then((runtime) => coreHandleAction(action, params, runtime));
}
