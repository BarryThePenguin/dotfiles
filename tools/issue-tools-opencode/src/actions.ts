/**
 * OpenCode adapter shim for the Wayfinder/Issue action surface.
 *
 * Handler bodies live in issue-tools-core. This file wires the OpenCode host
 * context into an ActionRuntime<ActionResult> and delegates to handleAction.
 */

import {
	createActionHandler,
	type ActionMap,
	type FileBackedTrackerSession,
} from "issue-tools-core";

export type { ActionMap };

export type ActionResult = {
	output: string;
	metadata: Record<string, unknown>;
};

export function handleAction<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	session: FileBackedTrackerSession,
): Promise<ActionResult> {
	const handler = createActionHandler<ActionResult>(session, {
		success: (text, metadata) => ({ output: text, metadata }),
		error: (message) => ({ output: `Error: ${message}`, metadata: {} }),
	});

	return handler(action, params);
}
