/**
 * OpenCode adapter shim for the Wayfinder/Issue action surface.
 *
 * Handler bodies live in issue-tools-core. This file wires the OpenCode host
 * context into an ActionRuntime<ActionResult> and delegates to handleAction.
 */

import {
	handleAction as coreHandleAction,
	type ActionMap,
} from "issue-tools-core";
import { createActionRuntime, type ActionResult } from "./action-runtime.ts";
import type { OpenCodeSession } from "./tracker.ts";

export type { ActionMap };

export interface ToolContext {
	session: OpenCodeSession;
}

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	ctx: ToolContext,
): Promise<ActionResult> {
	return createActionRuntime(ctx).then((runtime) =>
		coreHandleAction(action, params, runtime),
	);
}
