import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OpenCodeGoUsageClient } from "opencode-go-usage";
import { DEFAULT_QUOTA_POLICY } from "./agent-runner.ts";
import { createLauncher, loadLauncherDeps, type Launcher } from "./launcher.ts";
import { MAX_PARALLEL_TASKS, PARALLEL_CONCURRENCY } from "./parallel-run.ts";
import { chooseQuotaRoute } from "./quota-routing.ts";
import { spawnBackgroundAgent } from "./run.ts";
import type { SpawnContext } from "./types.ts";

interface BackgroundCommandContext {
	cwd: string;
	model?: { provider?: string } | undefined;
	ui: {
		notify(message: string, level: "info" | "error" | "warning"): void;
	};
}

interface BackgroundBrief {
	agentName: string;
	brief: string;
}

/** One task per non-empty line: `[agent:<name>] <brief>` (default agent: general). */
export function parseBackgroundBriefs(input: string): BackgroundBrief[] {
	return input
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const agentMatch = line.match(/^agent:(\S+)\s+([\s\S]*)$/);
			if (agentMatch) {
				const matchedBrief = (agentMatch[2] ?? "").trim();
				return {
					agentName: agentMatch[1] || "general",
					brief: matchedBrief || line,
				};
			}
			return { agentName: "general", brief: line };
		});
}

function resolveBriefs(
	launcher: Launcher,
	briefs: readonly BackgroundBrief[],
	ctx: BackgroundCommandContext,
): SpawnContext[] {
	const contexts: SpawnContext[] = [];
	for (const { agentName, brief } of briefs) {
		const resolution = launcher.resolve(agentName, brief);
		if ("result" in resolution) {
			ctx.ui.notify(resolution.result.stderr, "error");
			continue;
		}
		contexts.push(resolution.context);
	}
	return contexts;
}

export function createBackgroundCommandHandler(pi: ExtensionAPI) {
	return async (args: string, ctx: BackgroundCommandContext): Promise<void> => {
		const briefs = parseBackgroundBriefs(args);
		if (briefs.length === 0) {
			ctx.ui.notify(
				"/subagent-bg needs a brief: /subagent-bg [agent:<name>] <brief> (one per line to run several in parallel)",
				"error",
			);
			return;
		}
		if (briefs.length > MAX_PARALLEL_TASKS) {
			ctx.ui.notify(
				`Too many background tasks (${briefs.length}). Max is ${MAX_PARALLEL_TASKS}.`,
				"error",
			);
			return;
		}

		const launcher = createLauncher(
			{ cwd: ctx.cwd, parentProvider: ctx.model?.provider },
			loadLauncherDeps(ctx.cwd),
		);
		const contexts = resolveBriefs(launcher, briefs, ctx);
		if (contexts.length === 0) {
			return;
		}

		const launchOne = async (context: SpawnContext) => {
			const { agent } = context;
			const usage = await new OpenCodeGoUsageClient().get();
			const decision = chooseQuotaRoute(context, usage, DEFAULT_QUOTA_POLICY);
			const routedContext = decision.context;

			const handle = spawnBackgroundAgent({
				context: routedContext,
				onSettled: ({ finalOutput, sessionDir }) => {
					const summary = finalOutput.trim() || "(no text output)";
					const message =
						`Background subagent "${agent.name}" settled (session: ${sessionDir}).\n\n` +
						(summary.length > 4000
							? `${summary.slice(0, 4000)}\n…(truncated)`
							: summary);
					pi.sendUserMessage(message, { deliverAs: "followUp" });
					ctx.ui.notify(`Background subagent "${agent.name}" settled`, "info");
					startNext();
				},
				onError: (error) => {
					pi.sendUserMessage(
						`Background subagent "${agent.name}" failed: ${error}`,
						{ deliverAs: "followUp" },
					);
					ctx.ui.notify(
						`Background subagent "${agent.name}" failed: ${error}`,
						"error",
					);
					startNext();
				},
			});

			ctx.ui.notify(
				`Background subagent "${handle.agent}" started (session dir: ${handle.sessionDir}). ` +
					(decision.policy === "fallback"
						? `Using quota fallback (${decision.reason}). `
						: "") +
					"You'll be notified when it settles; resume with pi --session-dir <dir> --resume.",
				"info",
			);
		};

		let nextIndex = 0;
		const startNext = () => {
			if (nextIndex >= contexts.length) {
				return;
			}
			const context = contexts[nextIndex++];
			if (context) {
				void launchOne(context);
			}
		};

		const initialBatch = Math.min(PARALLEL_CONCURRENCY, contexts.length);
		for (let i = 0; i < initialBatch; i++) {
			startNext();
		}
	};
}
