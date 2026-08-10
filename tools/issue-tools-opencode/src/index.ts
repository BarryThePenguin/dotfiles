/**
 * issue-tools-opencode plugin.
 *
 * Registers the same wayfinder_* and issue_* tool surface as the Pi
 * extension, plus an `issue_tracker_setup` tool, all backed by the shared
 * issue-tools-core domain and session lifecycle. Tool names and param shapes
 * are identical to the Pi surface so docs and skills apply to both hosts.
 */

import { tool, type Hooks, type Plugin } from "@opencode-ai/plugin";
import { createContainer, type DriverFactory } from "doist-core";
import { detectTrackerSelection } from "issue-tools-core";
import { handleAction } from "./actions.ts";
import { TOOLS } from "./tool-schemas.ts";
import { getOpenCodeSession } from "./tracker.ts";

type SetupArgs = {
	tracker?: "local" | "todoist" | "auto";
	project_id?: string;
};

type SetupResult = { output: string; metadata: Record<string, unknown> };

let driverFactory: DriverFactory;

try {
	const { Database } = await import("bun:sqlite");
	driverFactory = (path: string) => new Database(path);
} catch {
	const { DatabaseSync } = await import("node:sqlite");
	driverFactory = (path: string) => new DatabaseSync(path);
}

function runSetup(worktree: string, args: SetupArgs): SetupResult {
	if (args.tracker) {
		getOpenCodeSession(worktree).setTrackerMode(args.tracker);
		const mode =
			args.tracker === "auto" ? "auto (re-detected on next use)" : args.tracker;
		return {
			output: `Tracker mode: ${mode}.`,
			metadata: { tracker: args.tracker },
		};
	}

	const selection = detectTrackerSelection(worktree, driverFactory);
	if (selection === "local") {
		return {
			output:
				"Local Markdown tracker active (.scratch). Wayfinder and Issue tools are ready.",
			metadata: { tracker: "local" },
		};
	}
	if (selection === "neither") {
		return {
			output:
				"No tracker configured. Create a .scratch/ directory for local mode, or run `doist projects add` to configure Todoist, then re-run this tool.",
			metadata: { tracker: null },
		};
	}

	const container = createContainer(driverFactory, worktree);
	const projects = container.listProjects();
	if (projects.length === 0) {
		return {
			output:
				"No projects in .doistrc. Add one with `doist projects add`, then re-run this tool.",
			metadata: { tracker: "todoist", projects: [] },
		};
	}

	const selected = args.project_id
		? projects.find((project) => project.id === args.project_id)
		: (projects.find((project) => project.repo === true) ?? projects[0]);

	if (!selected) {
		return {
			output: `Project ${args.project_id} not found in .doistrc. Available: ${projects.map((project) => project.id).join(", ")}`,
			metadata: { tracker: "todoist" },
		};
	}

	container.setRepoProject(selected.id);
	getOpenCodeSession(worktree).setTrackerMode("todoist");
	const note =
		selection === "both"
			? " Both .scratch and .doistrc are present; re-run with tracker: 'local' to force local mode."
			: "";
	return {
		output: `Marked ${selected.id} as the repo project. Todoist tracker active.${note}`,
		metadata: { tracker: "todoist", projectId: selected.id },
	};
}

export const issueToolsPlugin: Plugin = ((): Promise<Hooks> => {
	const tools: Hooks["tool"] = {};

	for (const spec of TOOLS) {
		tools[spec.name] = tool({
			description: spec.description,
			args: spec.args,
			async execute(args, ctx) {
				ctx.metadata({ title: spec.title });
				const result = await handleAction(
					spec.action,
					args as never,
					{ session: getOpenCodeSession(ctx.worktree) },
					{ worktree: ctx.worktree },
				);
				return { output: result.output, metadata: result.metadata };
			},
		});
	}

	tools["issue_tracker_setup"] = tool({
		description:
			"Configure which Issue tracker this repo uses: wire the repo's .doistrc project (Todoist) or confirm local Markdown (.scratch).",
		args: {
			tracker: tool.schema
				.enum(["local", "todoist", "auto"])
				.optional()
				.describe("Force the tracker mode ('auto' clears a previous override)"),
			project_id: tool.schema
				.string()
				.optional()
				.describe(
					"Todoist project ID to mark as the repo project when .doistrc has several",
				),
		},
		execute(args, ctx) {
			ctx.metadata({ title: "Issue: Setup Tracker" });
			return Promise.resolve(runSetup(ctx.worktree, args));
		},
	});

	return Promise.resolve({ tool: tools });
}) satisfies Plugin;

export default issueToolsPlugin;
