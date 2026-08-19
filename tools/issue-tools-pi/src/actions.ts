/**
 * Pi adapter shim for the Wayfinder/Issue action surface.
 *
 * Handler bodies live in issue-tools-core. This file wires the Pi host context
 * (TrackerSession) into an ActionRuntime<ActionResult> and delegates to the
 * shared handleAction.
 */

import {
	handleAction as coreHandleAction,
	type ActionMap,
	type TrackerSession,
} from "issue-tools-core";
import { createActionRuntime, type ActionResult } from "./action-runtime.ts";

export type { ActionMap };

export interface ToolContext {
	trackerSession: TrackerSession;
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
