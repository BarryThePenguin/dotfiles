/**
 * issue-tools-opencode plugin.
 *
 * Registers the same wayfinder_* and issue_* tool surface as the Pi
 * extension, plus an `issue_tracker_setup` tool, all backed by the shared
 * issue-tools-core domain and session lifecycle. Tool names and param shapes
 * are identical to the Pi surface so docs and skills apply to both hosts.
 */

import { Plugin } from "@opencode-ai/plugin";
import { Schema } from "effect";
import { createContainer } from "doist-core";
import { detectTrackerSelection } from "issue-tools-core";
import { handleAction } from "./actions.ts";
import { TOOLS } from "./tool-schemas.ts";
import { getOpenCodeSession } from "./tracker.ts";

type SetupArgs = {
	tracker?: "local" | "todoist" | "auto" | undefined;
	project_id?: string | undefined;
};

type SetupResult = { output: string; metadata: Record<string, unknown> };

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

	const selection = detectTrackerSelection(worktree);
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

	const container = createContainer(worktree);
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

export default Plugin.define({
	id: "issue-tools-opencode",
	setup: async ({ tool, session }) => {
		await tool.transform((tools) => {
			for (const { action, input, description, name, title } of TOOLS) {
				tools.add({
					options: {
						codemode: false,
					},
					name,
					description,
					input,
					async execute(args, ctx) {
						await ctx.progress({ title });
						const { location } = await session.get(ctx);
						const result = await handleAction(
							action,
							args,
							{ session: getOpenCodeSession(location.directory) },
							{ worktree: location.directory },
						);
						return { output: result.output, metadata: result.metadata };
					},
				});
			}

			tools.add({
				name: "issue_tracker_setup",
				description:
					"Configure which Issue tracker this repo uses: wire the repo's .doistrc project (Todoist) or confirm local Markdown (.scratch).",
				input: Schema.Struct({
					tracker: Schema.optional(
						Schema.Literals(["local", "todoist", "auto"]),
					).annotate({
						description:
							"Force the tracker mode ('auto' clears a previous override)",
					}),
					project_id: Schema.optional(Schema.String).annotate({
						description:
							"Todoist project ID to mark as the repo project when .doistrc has several",
					}),
				}),
				async execute(args, ctx) {
					await ctx.progress({ title: "Issue Tracker Setup" });
					const { location } = await session.get(ctx);
					return runSetup(location.directory, args);
				},
			});
		});
	},
});
