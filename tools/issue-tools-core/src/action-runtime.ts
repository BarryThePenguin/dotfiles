import type { TrackerMode } from "./session.ts";
import type { TrackerModules } from "./modules.ts";
import type { ActionRuntime } from "./actions.ts";

export interface ActionRuntimeOptions<R> {
	loadModules(): Promise<{ modules: TrackerModules; mode: TrackerMode }>;
	loadClaimant(): Promise<string>;
	requireMapId(params: { map_id?: string }): string | null;
	getActiveMap(): string | null;
	setActiveMap(mapId: string): void;
	trackerDetails(mode: TrackerMode): Record<string, unknown>;
	success(text: string, details: Record<string, unknown>): R;
	error(message: string): R;
}

/** Builds the host-independent runtime used by the action handlers. */
export async function createActionRuntime<R>(
	options: ActionRuntimeOptions<R>,
): Promise<ActionRuntime<R>> {
	const [{ modules, mode }, claimant] = await Promise.all([
		options.loadModules(),
		options.loadClaimant(),
	]);
	const trackerDetails = options.trackerDetails(mode);

	return {
		get wayfinder() {
			return modules.wayfinder;
		},
		get issues() {
			return modules.issues;
		},
		requireMapId: (params) => options.requireMapId(params),
		getActiveMap: () => options.getActiveMap(),
		setActiveMap: (mapId) => {
			options.setActiveMap(mapId);
		},
		claimant: () => claimant,
		success: (text, details = {}) =>
			options.success(text, { ...trackerDetails, ...details }),
		error: (message) => options.error(message),
	};
}
