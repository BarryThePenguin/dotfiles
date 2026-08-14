/**
 * OpenCode action runtime — adapts OpenCodeSession into ActionRuntime<ActionResult>.
 */

import { localTrackerRoot, type ActionRuntime } from "issue-tools-core";
import type { OpenCodeSession } from "./tracker.ts";

export type ActionResult = {
	output: string;
	metadata: Record<string, unknown>;
};

type HostContext = {
	worktree: string;
};

type RuntimeContext = {
	session: OpenCodeSession;
};

export async function createActionRuntime(
	host: HostContext,
	ctx: RuntimeContext,
): Promise<ActionRuntime<ActionResult>> {
	const [modules, claimant] = await Promise.all([
		ctx.session.get(),
		ctx.session.getClaimant(),
	]);
	const mode = ctx.session.getMode() ?? "local";
	const trackerDetails = {
		tracker: mode,
		...(mode === "local" ? { root: localTrackerRoot(host.worktree) } : {}),
	};

	const details = (extra: Record<string, unknown>) => ({
		...trackerDetails,
		...extra,
	});

	const success = (
		text: string,
		extra: Record<string, unknown> = {},
	): ActionResult => ({
		output: text,
		metadata: details(extra),
	});

	return {
		wayfinder() {
			return modules.wayfinder;
		},
		issues() {
			return modules.issues;
		},
		requireMapId(params) {
			return ctx.session.resolveMapId(params.map_id);
		},
		getActiveMap() {
			return ctx.session.getActiveMap();
		},
		setActiveMap(mapId) {
			ctx.session.setActiveMap(mapId);
		},
		claimant() {
			return claimant;
		},
		success,
		error(message) {
			return { output: `Error: ${message}`, metadata: {} };
		},
	};
}
