import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OpenCodeGoUsageClient } from "opencode-go-usage";
import { DEFAULT_QUOTA_POLICY } from "./agent-runner.ts";
import { createLauncher, loadLauncherDeps } from "./launcher.ts";
import { chooseQuotaRoute } from "./quota-routing.ts";
import { spawnBackgroundAgent } from "./run.ts";

interface BackgroundCommandContext {
	cwd: string;
	model?: { provider?: string } | undefined;
	ui: {
		notify(message: string, level: "info" | "error" | "warning"): void;
	};
}

export function createBackgroundCommandHandler(pi: ExtensionAPI) {
	return async (args: string, ctx: BackgroundCommandContext): Promise<void> => {
		const task = args.trim();
		if (!task) {
			ctx.ui.notify(
				"/subagent-bg needs a brief: /subagent-bg [agent:<name>] <brief>",
				"error",
			);
			return;
		}

		let agentName = "general";
		let brief = task;
		const agentMatch = task.match(/^agent:(\S+)\s+([\s\S]*)$/);
		if (agentMatch) {
			const matchedName = agentMatch[1];
			const matchedBrief = agentMatch[2];
			if (matchedName) {
				agentName = matchedName;
			}
			brief = (matchedBrief ?? "").trim() || task;
		}

		const launcher = createLauncher(
			{ cwd: ctx.cwd, parentProvider: ctx.model?.provider },
			loadLauncherDeps(ctx.cwd),
		);
		const resolution = launcher.resolve(agentName, brief);
		if ("result" in resolution) {
			ctx.ui.notify(resolution.result.stderr, "error");
			return;
		}

		const { context } = resolution;
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
}
