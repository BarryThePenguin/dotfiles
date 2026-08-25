/**
 * issue-tools-opencode plugin.
 *
 * Registers the same wayfinder_* and issue_* tool surface as the Pi
 * extension, plus an `issue_tracker_setup` tool, all backed by the shared
 * issue-tools-core domain and session lifecycle.
 *
 * The action tools are registered straight from the shared tool catalog in
 * issue-tools-core — names, descriptions, titles, and the JSON Schema param
 * shapes all come from there, so the surface is identical to the Pi
 * extension by construction — no hand-rolled duplicates to drift. The
 * opencode-only `issue_tracker_setup` tool is defined here.
 */

import { Plugin } from "@opencode-ai/plugin/effect";
import type { SessionDomain } from "@opencode-ai/plugin/effect/session";
import { Tool } from "@opencode-ai/schema/tool";
import { createContainer } from "doist-core";
import { Effect, Schema } from "effect";
import {
	detectTrackerSelection,
	runTodoistSetup,
	toolCatalog,
	type ActionMap,
	type ToolCatalogEntry,
} from "issue-tools-core";
import { handleAction, type ActionResult } from "./actions.ts";
import { createSessionRegistry, type SessionRegistry } from "./tracker.ts";

const registry = createSessionRegistry();

/**
 * Output schema for every action tool.
 *
 * Empirically, opencode has rejected both a plain string declaration and a
 * Tool.Result-shaped struct depending on which layer validates the result,
 * so declare the most tolerant schema possible: `Schema.Unknown` encodes
 * identity and accepts anything any layer might feed it (the handlers'
 * markdown string, the `{ output, metadata }` wrapper, or future shapes).
 * The readable text still reaches the model via the encoded output/content.
 */
const ToolResultOutput = Schema.Unknown;

type SetupArgs = {
	tracker?: "local" | "todoist" | "auto" | undefined;
	project_id?: string | undefined;
};

async function runSetup(
	worktree: string,
	args: SetupArgs,
	registry: SessionRegistry,
): Promise<ActionResult> {
	const session = registry.get(worktree);
	if (args.tracker) {
		session.setTrackerMode(args.tracker);
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

	const note =
		selection === "both"
			? " Both .scratch and .doistrc are present; re-run with tracker: 'local' to force local mode."
			: "";
	const container = createContainer(worktree);
	const outcome = await runTodoistSetup({
		container,
		selectProject: (projects) => {
			if (args.project_id) {
				return args.project_id;
			}
			return (projects.find((p) => p.repo === true) ?? projects[0])?.id;
		},
	});

	switch (outcome.status) {
		case "success":
			session.setTrackerMode("todoist");
			return {
				output: `Marked ${outcome.projectId} as the repo project. Todoist tracker active.${note}`,
				metadata: { tracker: "todoist", projectId: outcome.projectId },
			};
		case "no-projects":
			return {
				output:
					"No projects in .doistrc. Add one with `doist projects add`, then re-run this tool.",
				metadata: { tracker: "todoist", projects: [] },
			};
		case "not-found":
			return {
				output: `Project ${args.project_id} not found in .doistrc. Available: ${outcome.available.join(", ")}`,
				metadata: { tracker: "todoist" },
			};
		case "cancelled":
			return {
				output: "Setup cancelled.",
				metadata: { tracker: "todoist" },
			};
	}
}

/** Map a thrown Promise/sync failure onto the tool failure channel. */
function toToolError(cause: unknown): Tool.Error {
	return cause instanceof Error
		? new Tool.Error({ message: cause.message, error: cause })
		: new Tool.Error({ message: String(cause), error: cause });
}

/** Resolve the executing session's worktree, bridging the client API to the typed failure channel. */
function resolveWorktree(
	toolCtx: Tool.Context,
	session: SessionDomain,
): Effect.Effect<string, Tool.Error> {
	return session.get({ sessionID: toolCtx.sessionID }).pipe(
		Effect.map((info) => info.location.directory),
		Effect.mapError(toToolError),
	);
}

/** Shape an action result for the opencode `Tool.Result` output. */
function toToolResult(result: ActionResult): Tool.Result {
	return { output: result.output, metadata: result.metadata };
}

/**
 * Shared tool-execution pipeline: progress, resolve the worktree, then run.
 * Failures flow through the `Tool.Error` channel; the result is shaped for
 * the opencode output.
 */
function runTool(
	ctx: Tool.Context,
	session: SessionDomain,
	title: string,
	run: (worktree: string) => Effect.Effect<ActionResult, Tool.Error>,
): Effect.Effect<Tool.Result, Tool.Error> {
	return Effect.gen(function* () {
		yield* ctx.progress({ title });
		const worktree = yield* resolveWorktree(ctx, session);
		return yield* run(worktree);
	}).pipe(Effect.map(toToolResult));
}

/**
 * Build an action-tool registration from a tool-catalog entry. `params` is
 * the catalog's host-agnostic JSON Schema, so the args shape matches the Pi
 * surface by construction. Only Effect's stricter `JsonSchema` typing
 * (string-indexed `properties`) needs a cast — the schema objects themselves
 * are valid JSON Schema.
 */
function actionTool(session: SessionDomain, spec: ToolCatalogEntry): Tool.Info {
	return {
		name: spec.name,
		description: spec.description,
		input: spec.params as Tool.ValueSchema,
		output: ToolResultOutput,
		options: { codemode: false },
		execute: (args, ctx) =>
			runTool(ctx, session, spec.title, (worktree) =>
				Effect.tryPromise({
					try: () =>
						handleAction(
							spec.action,
							args as ActionMap[keyof ActionMap],
							registry.get(worktree),
						),
					catch: toToolError,
				}),
			),
	};
}

export default Plugin.define({
	id: "issue-tools-opencode",
	effect: ({ tool, session }) =>
		Effect.gen(function* () {
			yield* tool.transform((tools) => {
				for (const tool of toolCatalog) {
					tools.add(actionTool(session, tool));
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
					output: ToolResultOutput,
					options: { codemode: false },
					execute: (args, ctx) =>
						runTool(ctx, session, "Issue Tracker Setup", (worktree) =>
							Effect.tryPromise({
								try: () => runSetup(worktree, args, registry),
								catch: toToolError,
							}),
						),
				});
			});
		}),
});
