import { describe, expect, it } from "vitest";
import { createSpawnContext, resolveSpawnContext } from "./launcher.ts";

const agent = {
	name: "general",
	description: "general",
	systemPrompt: "You are general",
	source: "user" as const,
	filePath: "/agents/general.md",
	model: "base-model",
};

describe("createSpawnContext", () => {
	it("packages effective config and task settings for foreground and background", () => {
		const context = createSpawnContext({
			agent,
			task: "Research this",
			cwd: "/repo",
			overrides: new Map([
				["general", { provider: "gpt", model: "override-model" }],
			]),
			parentProvider: "opencode-go",
		});

		expect(context).toMatchObject({
			agent,
			task: "Research this",
			cwd: "/repo",
			effective: { provider: "gpt", model: "override-model" },
		});
	});
});

describe("resolveSpawnContext", () => {
	it("preserves unknown-agent results while resolving known aliases", () => {
		const known = resolveSpawnContext({
			defaultCwd: "/repo",
			agents: [agent],
			agentName: "GENERAL",
			task: "Review this",
			overrides: new Map(),
		});
		const aliasedGeneral = resolveSpawnContext({
			defaultCwd: "/repo",
			agents: [agent],
			agentName: "general-purpose",
			task: "Review this",
			overrides: new Map(),
		});
		const explore = { ...agent, name: "explore" };
		const aliasedExplore = resolveSpawnContext({
			defaultCwd: "/repo",
			agents: [explore],
			agentName: "Explore",
			task: "Explore this",
			overrides: new Map(),
		});
		const unknown = resolveSpawnContext({
			defaultCwd: "/repo",
			agents: [agent],
			agentName: "missing",
			task: "Review this",
			overrides: new Map(),
		});

		expect("context" in known && known.context.agent).toBe(agent);
		expect("context" in aliasedGeneral && aliasedGeneral.context.agent).toBe(
			agent,
		);
		expect("context" in aliasedExplore && aliasedExplore.context.agent).toBe(
			explore,
		);
		expect("result" in unknown && unknown.result).toMatchObject({
			agent: "missing",
			agentSource: "unknown",
			exitCode: 1,
		});
	});
});
