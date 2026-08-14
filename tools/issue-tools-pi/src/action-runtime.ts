import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	localTrackerRoot,
	type ActionRuntime,
	type TrackerSession,
} from "issue-tools-core";

export type ActionResult = {
	content: { type: "text"; text: string }[];
	details: unknown;
};

type RuntimeContext = {
	trackerSession: TrackerSession;
};

export async function createActionRuntime(
	ext: ExtensionContext,
	ctx: RuntimeContext,
): Promise<ActionRuntime<ActionResult>> {
	const [modules, claimant] = await Promise.all([
		ctx.trackerSession.get(ext),
		ctx.trackerSession.getClaimant(),
	]);
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
		claimant() {
			return claimant;
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
