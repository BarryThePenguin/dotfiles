/**
 * Pi extension for the shared issue-tools surface.
 *
 * Registers the full `wayfinder_*` and `issue_*` tool catalog from
 * issue-tools-core — names, labels, descriptions, and parameter schemas all
 * come from the catalog so this surface matches the opencode plugin by
 * construction — backed by a per-session tracker (local Markdown or Todoist),
 * plus a `/setup-issue-tracker` command.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createContainer } from "doist-core";
import { Type } from "typebox";
import {
	createLocalTrackerModules,
	createTodoistTrackerModules,
	createTrackerSession,
	detectTrackerSelection,
	localTrackerRoot,
	runTodoistSetup,
	toolCatalog,
	type SessionStateStore,
	type TrackerMode,
} from "issue-tools-core";
import { handleAction, type ActionMap, type ToolContext } from "./actions.ts";
import { renderCall, renderResult, type RenderCallArgs } from "./render.ts";

const STATUS_KEY = "issue-tools";

function createPiSessionStore(
	pi: ExtensionAPI,
	initial: string | null,
): SessionStateStore {
	let state = { activeMap: initial };
	return {
		read: () => state,
		write: (s) => {
			state = s;
			pi.appendEntry("issue-tools-state", { activeMap: s.activeMap });
		},
	};
}

export default function issueToolsExtension(pi: ExtensionAPI) {
	let latestCtx: ExtensionContext | null = null;

	const selectTrackerMode = async (): Promise<TrackerMode> => {
		const ctx = latestCtx;
		if (!ctx) {
			return "local";
		}
		const { mode, prompted } = await resolveTrackerMode(
			ctx,
			"Wayfinder tracker",
		);
		if (mode === null) {
			// ambiguous and no UI to ask: default to local
			return "local";
		}
		if (prompted) {
			ctx.ui.notify(`Wayfinder tracker: ${mode}`, "info");
		}
		return mode;
	};

	const updateStatus = (state: {
		mode: TrackerMode | null;
		activeMap: string | null;
		cwd: string;
	}) => {
		const ctx = latestCtx;
		if (!ctx) {
			return;
		}
		const mode = state.mode ?? detectTrackerSelection(state.cwd);
		if (mode === "both" || mode === "neither") {
			ctx.ui.setStatus(
				STATUS_KEY,
				ctx.ui.theme.fg("warning", "🗺 choose tracker"),
			);
			return;
		}
		const label = state.activeMap
			? `🗺 ${mode}:${state.activeMap}`
			: `🗺 ${mode}`;
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg(
				"accent",
				mode === "local"
					? `${label} (${localTrackerRoot(state.cwd)})`
					: label,
			),
		);
	};

	const getState = (): ToolContext => ({ trackerSession });

	// -- Session lifecycle ---------------------------------------------------

	const createSession = (cwd: string, store: SessionStateStore) =>
		createTrackerSession({
			cwd,
			selectMode: selectTrackerMode,
			buildLocalModules: () => createLocalTrackerModules(localTrackerRoot(cwd)),
			buildTodoistModules: () => createTodoistTrackerModules(cwd),
			store,
			updateStatus,
		});

	let trackerSession = createSession(".", createPiSessionStore(pi, null));

	pi.on("session_start", (_event, ctx) => {
		let recoveredActiveMap: string | null = null;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === "issue-tools-state") {
				// `maps` was dropped from the persisted shape; older sessions may
				// still carry it. We just ignore it.
				const data = entry.data as { activeMap?: string | null } | undefined;
				recoveredActiveMap = data?.activeMap ?? null;
			}
		}
		const store = createPiSessionStore(pi, recoveredActiveMap);
		latestCtx = ctx;
		trackerSession = createSession(ctx.cwd, store);
	});

	// -- Tools ---------------------------------------------------------------

	for (const tool of toolCatalog) {
		pi.registerTool({
			name: tool.name,
			label: tool.title,
			description: tool.description,
			promptSnippet: tool.promptSnippet,
			parameters: Type.Unsafe(tool.params),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				latestCtx = ctx;
				return handleAction(
					tool.action,
					params as ActionMap[keyof ActionMap],
					getState(),
				);
			},
			renderCall: (args, theme) =>
				renderCall(tool.action, args as RenderCallArgs, theme),
			renderResult,
		});
	}

	// -- /setup-issue-tracker command -----------------------------------

	pi.registerCommand("setup-issue-tracker", {
		description:
			"Wire the repo's .doistrc (or detect a local tracker) so this repo's issue tracker is configured for the issue_* and wayfinder_* tools, then hand off to the setup-matt-pocock-skills skill for the docs.",
		async handler(_args, ctx) {
			await runSetupIssueTracker(ctx);
		},
	});
}

/**
 * Resolve a repo's tracker mode: a clear selection returns immediately;
 * otherwise (both markers or neither) prompt the user. Returns
 * `{ mode: null }` when the repo is ambiguous and there is no UI to ask —
 * callers decide the fallback. `prompted` is true only when the mode was
 * chosen through the UI.
 */
async function resolveTrackerMode(
	ctx: ExtensionContext,
	promptTitle: string,
): Promise<{ mode: "local" | "todoist" | null; prompted: boolean }> {
	const selection = detectTrackerSelection(ctx.cwd);
	if (selection === "local" || selection === "todoist") {
		return { mode: selection, prompted: false };
	}
	if (!ctx.hasUI) {
		return { mode: null, prompted: false };
	}
	const choice = await ctx.ui.select(promptTitle, [
		"Local Markdown (.scratch)",
		"Todoist (.doistrc)",
	]);
	return {
		mode: choice === "Todoist (.doistrc)" ? "todoist" : "local",
		prompted: true,
	};
}

async function runSetupIssueTracker(ctx: ExtensionCommandContext) {
	const { mode } = await resolveTrackerMode(ctx, "Issue tracker");
	if (mode === null) {
		ctx.ui.notify(
			"Cannot determine tracker: no UI available to prompt.",
			"error",
		);
		return;
	}

	if (mode === "local") {
		ctx.ui.notify(
			"Local Markdown tracker selected. Run /setup-matt-pocock-skills to complete the docs.",
			"info",
		);
		return;
	}

	const container = createContainer(ctx.cwd);
	const outcome = await runTodoistSetup({
		container,
		selectProject: async (projects) => {
			if (projects.length === 1 || !ctx.hasUI) {
				return projects[0]?.id;
			}
			const labels = projects.map((p) => {
				const tag = p.repo === true ? " (repo)" : "";
				return `${p.id} — ${p.label}${tag}`;
			});
			const choice = await ctx.ui.select(
				"Select the repo's Todoist project (this becomes the repo Issues home)",
				labels,
			);
			if (!choice) {
				return undefined;
			}
			const idx = labels.indexOf(choice);
			return idx >= 0 ? projects[idx]?.id : undefined;
		},
	});

	switch (outcome.status) {
		case "success":
			ctx.ui.notify(
				`Marked ${outcome.projectId} as the repo project (repo: true).\n\nRun /setup-matt-pocock-skills to complete the docs.`,
				"info",
			);
			break;
		case "no-projects":
			ctx.ui.notify(
				"No projects in .doistrc. Add one with `doist projects add` first, then re-run /setup-issue-tracker.",
				"error",
			);
			break;
		case "not-found":
			ctx.ui.notify(
				`Project not found in .doistrc. Available: ${outcome.available.join(", ")}`,
				"error",
			);
			break;
		case "cancelled":
			ctx.ui.notify("Setup cancelled.", "info");
			break;
	}
}
