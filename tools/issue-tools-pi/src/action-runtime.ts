import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { IssueTracker, WayfinderTracker } from "issue-tools-core";
import { localTrackerRoot, type TrackerSession } from "./tracker.ts";

export type ActionResult = {
	content: { type: "text"; text: string }[];
	details: unknown;
};

export type ActionRuntime = {
	wayfinder(): WayfinderTracker;
	issues(): IssueTracker;
	requireMapId(params: { map_id?: string }): string | null;
	getActiveMap(): string | null;
	setActiveMap(mapId: string): void;
	success(text: string, details?: Record<string, unknown>): ActionResult;
	error(message: string): ActionResult;
};

type RuntimeContext = {
	trackerSession: TrackerSession;
};

export async function createActionRuntime(
	ext: ExtensionContext,
	ctx: RuntimeContext,
): Promise<ActionRuntime> {
	const modules = await ctx.trackerSession.get(ext);
	const mode = ctx.trackerSession.getMode() ?? "local";
	const trackerDetails = {
		tracker: mode,
		...(mode === "local" ? { root: localTrackerRoot(ext.cwd) } : {}),
	};

	const details = (extra: Record<string, unknown>) => ({
		...trackerDetails,
		...extra,
	});

	const success = (
		text: string,
		extra: Record<string, unknown> = {},
	): ActionResult => ({
		content: [{ type: "text", text }],
		details: details(extra),
	});

	return {
		wayfinder() {
			return modules.wayfinder;
		},
		issues() {
			return modules.issues;
		},
		requireMapId(params) {
			return ctx.trackerSession.resolveMapId(params.map_id);
		},
		getActiveMap() {
			return ctx.trackerSession.getActiveMap();
		},
		setActiveMap(mapId) {
			ctx.trackerSession.setActiveMap(mapId, ext);
		},
		success,
		error(message) {
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				details: {},
			};
		},
	};
}
