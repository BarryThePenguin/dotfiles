/**
 * opencode action runtime.
 *
 * The opencode equivalent of the Pi extension's action-runtime: adapts the
 * shared TrackerSession and the tool's host context into the small runtime
 * the handlers speak, producing opencode-shaped results
 * ({ output, metadata }) instead of Pi's { content, details }.
 */

import {
	localTrackerRoot,
	type IssueTracker,
	type WayfinderTracker,
} from "issue-tools-core";
import type { OpenCodeSession } from "./tracker.ts";

export type ActionResult = {
	output: string;
	metadata: Record<string, unknown>;
};

export type ActionRuntime = {
	wayfinder(): WayfinderTracker;
	issues(): IssueTracker;
	requireMapId(params: { map_id?: string }): string | null;
	getActiveMap(): string | null;
	setActiveMap(mapId: string): void;
	claimant(): string;
	success(text: string, details?: Record<string, unknown>): ActionResult;
	error(message: string): ActionResult;
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
): Promise<ActionRuntime> {
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
