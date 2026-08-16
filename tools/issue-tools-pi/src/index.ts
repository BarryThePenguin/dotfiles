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
	toolCatalog,
	type TrackerMode,
} from "issue-tools-core";
import { handleAction, type ActionMap, type ToolContext } from "./actions.ts";
import { renderCall, renderResult, type RenderCallArgs } from "./render.ts";

const STATUS_KEY = "issue-tools";

/** Pi-only per-tool prompt snippets, keyed by ActionMap key (exhaustive). */
const PROMPT_SNIPPETS = {
	chart:
		"Create a wayfinder map after confirming the destination with grilling and domain modeling",
	get_map: "Read the low-resolution wayfinder map from the selected tracker",
	list_maps: "List wayfinder maps from the selected tracker",
	create_ticket: "Create a wayfinder ticket on the selected tracker",
	get_ticket: "Read a wayfinder ticket from the selected tracker",
	resolve: "Resolve a wayfinder ticket on the selected tracker",
	update_map: "Update a wayfinder map section on the selected tracker",
	set_blocking: "Set blocking on a wayfinder ticket on the selected tracker",
	list_frontier: "List wayfinder frontier tickets from the selected tracker",
	claim: "Claim a wayfinder ticket on the selected tracker",
	issue_create: "Create a repository Issue/spec",
	issue_read: "Read a repository Issue/spec by ID or URL",
	issue_label: "Add or remove triage labels on a repository Issue/spec",
	issue_comment: "Post a comment on a repository Issue/spec",
	issue_close: "Close a repository Issue/spec",
	issue_list: "List repository Issues/specs",
} as const satisfies Record<keyof ActionMap, string>;

export default function issueToolsExtension(pi: ExtensionAPI) {
	const persistState = (activeMap: string | null) => {
		pi.appendEntry("issue-tools-state", { activeMap });
	};

	const selectTrackerMode = async (
		ctx: ExtensionContext,
	): Promise<TrackerMode> => {
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

	const updateStatus = (
		ctx: ExtensionContext,
		state: { mode: TrackerMode | null; activeMap: string | null },
	) => {
		const mode = state.mode ?? detectTrackerSelection(ctx.cwd);
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
				mode === "local" ? `${label} (${localTrackerRoot(ctx.cwd)})` : label,
			),
		);
	};

	const getState = (): ToolContext => ({ trackerSession });

	// -- Session lifecycle ---------------------------------------------------

	const createSession = (cwd: string) =>
		createTrackerSession({
			cwd,
			selectMode: selectTrackerMode,
			buildLocalModules: () => createLocalTrackerModules(localTrackerRoot(cwd)),
			buildTodoistModules: () => createTodoistTrackerModules(cwd),
			persistState,
			updateStatus,
		});

	let trackerSession = createSession(".");

	pi.on("session_start", (_event, ctx) => {
		trackerSession = createSession(ctx.cwd);
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === "issue-tools-state") {
				// `maps` was dropped from the persisted shape; older sessions may
				// still carry it. We just ignore it.
				const data = entry.data as { activeMap?: string | null } | undefined;
				trackerSession.restore({ activeMap: data?.activeMap ?? null });
			}
		}
		trackerSession.refresh(ctx);
	});

	// -- Tools ---------------------------------------------------------------

	for (const tool of toolCatalog) {
		pi.registerTool({
			name: tool.name,
			label: tool.title,
			description: tool.description,
			promptSnippet: PROMPT_SNIPPETS[tool.action],
			parameters: Type.Unsafe(tool.params),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				return handleAction(
					tool.action,
					params as ActionMap[keyof ActionMap],
					getState(),
					ctx,
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

	const container = createContainer();
	const projects = container.listProjects();
	if (projects.length === 0) {
		ctx.ui.notify(
			"No projects in .doistrc. Add one with `doist projects add` first, then re-run /setup-issue-tracker.",
			"error",
		);
		return;
	}

	let selectedId: string | undefined;
	if (projects.length === 1) {
		selectedId = projects[0]?.id;
	} else if (ctx.hasUI) {
		const labels = projects.map((project) => {
			const tag = project.repo === true ? " (repo)" : "";
			return `${project.id} — ${project.label}${tag}`;
		});
		const choice = await ctx.ui.select(
			"Select the repo's Todoist project (this becomes the repo Issues home)",
			labels,
		);
		if (!choice) {
			ctx.ui.notify("Setup cancelled.", "info");
			return;
		}
		selectedId = projects.find((project) => {
			const tag = project.repo === true ? " (repo)" : "";
			return `${project.id} — ${project.label}${tag}` === choice;
		})?.id;
	} else {
		selectedId = projects[0]?.id;
	}

	if (!selectedId) {
		ctx.ui.notify("Setup cancelled.", "info");
		return;
	}

	container.setRepoProject(selectedId);
	ctx.ui.notify(
		`Marked ${selectedId} as the repo project (repo: true).\n\nRun /setup-matt-pocock-skills to complete the docs.`,
		"info",
	);
}
