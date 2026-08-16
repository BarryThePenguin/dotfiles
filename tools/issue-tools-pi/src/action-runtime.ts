import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createActionRuntime as createCoreActionRuntime,
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
	return createCoreActionRuntime({
		loadModules: () => ctx.trackerSession.get(ext),
		loadClaimant: () => ctx.trackerSession.getClaimant(),
		getMode: () => ctx.trackerSession.getMode(),
		requireMapId: (params) => ctx.trackerSession.resolveMapId(params.map_id),
		getActiveMap: () => ctx.trackerSession.getActiveMap(),
		setActiveMap: (mapId) => {
			ctx.trackerSession.setActiveMap(mapId, ext);
		},
		trackerDetails: (mode) => ({
			tracker: mode,
			...(mode === "local" ? { root: localTrackerRoot(ext.cwd) } : {}),
		}),
		success: (text, details) => ({
			content: [{ type: "text", text }],
			details,
		}),
		error: (message) => ({
			content: [{ type: "text", text: `Error: ${message}` }],
			details: {},
		}),
	});
}
