import {
	createActionRuntime as createCoreActionRuntime,
	localTrackerRoot,
	type ActionRuntime,
	type TrackerSession,
} from "issue-tools-core";

export type ActionResult = {
	content: { type: "text"; text: string }[];
};

type RuntimeContext = {
	trackerSession: TrackerSession;
};

export async function createActionRuntime(
	ctx: RuntimeContext,
): Promise<ActionRuntime<ActionResult>> {
	return createCoreActionRuntime({
		loadModules: () => ctx.trackerSession.getModules(),
		loadClaimant: () => ctx.trackerSession.getClaimant(),
		requireMapId: (params) =>
			params.map_id ?? ctx.trackerSession.getActiveMap(),
		getActiveMap: () => ctx.trackerSession.getActiveMap(),
		setActiveMap: (mapId) => {
			ctx.trackerSession.setActiveMap(mapId);
		},
		trackerDetails: (mode) => ({
			tracker: mode,
			...(mode === "local"
				? { root: localTrackerRoot(ctx.trackerSession.getCwd()) }
				: {}),
		}),
		success: (text, _details) => ({
			content: [{ type: "text", text }],
		}),
		error: (message) => ({
			content: [{ type: "text", text: `Error: ${message}` }],
		}),
	});
}
