import { localTrackerRoot, type TrackerSession } from "./session.ts";
import { handleAction, type ActionMap, type ActionRuntime } from "./actions.ts";

/**
 * The subset of `TrackerSession` `createActionHandler` actually calls — it
 * never invalidates the session. `Pick` ties this to `TrackerSession` so a
 * signature change breaks the build here instead of drifting silently.
 */
type SessionLike = Pick<
	TrackerSession,
	"getModules" | "getClaimant" | "getActiveMap" | "setActiveMap" | "getCwd"
>;

export interface SessionRuntimeFormat<R> {
	success: (text: string, details: Record<string, unknown>) => R;
	error: (message: string) => R;
}

/**
 * Binds a host session and result format into a ready-to-use handleAction.
 *
 * Every host adapter (Claude, OpenCode, Pi) wires a session into an
 * ActionRuntime and delegates to handleAction the same way — this is that
 * wiring, done once. Adapters only ever vary the SessionLike shape and the
 * success/error result format; both are supplied here.
 */
export function createActionHandler<R>(
	session: SessionLike,
	format: SessionRuntimeFormat<R>,
): <K extends keyof ActionMap>(action: K, params: ActionMap[K]) => Promise<R> {
	return async (action, params) => {
		const [{ modules, mode }, claimant] = await Promise.all([
			session.getModules(),
			session.getClaimant(),
		]);
		const trackerDetails = {
			tracker: mode,
			...(mode === "local" ? { root: localTrackerRoot(session.getCwd()) } : {}),
		};

		const runtime: ActionRuntime<R> = {
			get wayfinder() {
				return modules.wayfinder;
			},
			get issues() {
				return modules.issues;
			},
			requireMapId: (p) => p.map_id ?? session.getActiveMap(),
			getActiveMap: () => session.getActiveMap(),
			setActiveMap: (mapId) => {
				session.setActiveMap(mapId);
			},
			claimant: () => claimant,
			success: (text, details = {}) =>
				format.success(text, { ...trackerDetails, ...details }),
			error: (message) => format.error(message),
		};

		return handleAction(action, params, runtime);
	};
}
