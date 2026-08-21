/**
 * OpenCode action runtime — adapts OpenCodeSession into ActionRuntime<ActionResult>.
 */

import {
	createActionRuntime as createCoreActionRuntime,
	localTrackerRoot,
	type ActionRuntime,
} from "issue-tools-core";
import type { OpenCodeSession } from "./tracker.ts";

export type ActionResult = {
	output: string;
	metadata: Record<string, unknown>;
};

type RuntimeContext = {
	session: OpenCodeSession;
};

export async function createActionRuntime(
	ctx: RuntimeContext,
): Promise<ActionRuntime<ActionResult>> {
	return createCoreActionRuntime({
		loadModules: () => ctx.session.getModules(),
		loadClaimant: () => ctx.session.getClaimant(),
		requireMapId: (params) => params.map_id ?? ctx.session.getActiveMap(),
		getActiveMap: () => ctx.session.getActiveMap(),
		setActiveMap: (mapId) => {
			ctx.session.setActiveMap(mapId);
		},
		trackerDetails: (mode) => ({
			tracker: mode,
			...(mode === "local"
				? { root: localTrackerRoot(ctx.session.getCwd()) }
				: {}),
		}),
		success: (text, metadata) => ({ output: text, metadata }),
		error: (message) => ({ output: `Error: ${message}`, metadata: {} }),
	});
}
