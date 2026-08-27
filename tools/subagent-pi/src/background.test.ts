import type { ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAgentName, type AgentConfig } from "./agents.ts";
import type { BackgroundAgentOptions } from "./run.ts";
import type { SpawnContext } from "./types.ts";

function makeAgent(name: string): AgentConfig {
	return {
		name,
		description: `${name} description`,
		systemPrompt: "",
		source: "user",
		filePath: `/agents/${name}.md`,
	};
}

const testState = vi.hoisted(() => ({
	spawnCalls: [] as Array<{ context: SpawnContext }>,
	spawnBehavior: "settle" as "settle" | "error" | "silent" | "manual",
	settledOutput: "task complete",
	settledSessionDir: "/tmp/pi-subagent-bg-xyz",
	errorMessage: "child crashed",
	pendingSettlers: [] as Array<{
		agent: string;
		settle: () => void;
		fail: () => void;
	}>,
}));

vi.mock("./launcher.ts", () => ({
	createLauncher: () => ({
		agents: [
			{ name: "general", source: "user" },
			{ name: "explore", source: "user" },
		],
		resolve: (agentName: string, task: string) => {
			const resolved = resolveAgentName(agentName);
			if (resolved !== "general" && resolved !== "explore") {
				return {
					result: {
						agent: agentName,
						agentSource: "unknown",
						task,
						exitCode: 1,
						messages: [],
						stderr: `Unknown agent: "${agentName}".`,
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							cost: 0,
							contextTokens: 0,
							turns: 0,
						},
					},
				};
			}
			return {
				context: {
					agent: makeAgent(resolved),
					task,
					cwd: "/repo",
					effective: {},
				} satisfies SpawnContext,
			};
		},
	}),
	loadLauncherDeps: () => ({ agents: [], overrides: new Map() }),
}));

vi.mock("opencode-go-usage", () => ({
	OpenCodeGoUsageClient: class {
		async get() {
			return { usage: null, stale: false, source: "none" as const };
		}
	},
}));

vi.mock("./quota-routing.ts", () => ({
	chooseQuotaRoute: (context: SpawnContext) => ({
		context,
		policy: "normal" as const,
		reason: "test",
	}),
}));

vi.mock("./run.ts", () => ({
	spawnBackgroundAgent: (options: BackgroundAgentOptions) => {
		testState.spawnCalls.push({ context: options.context });
		if (testState.spawnBehavior === "settle") {
			options.onSettled({
				finalOutput: testState.settledOutput,
				sessionDir: testState.settledSessionDir,
				agent: options.context.agent.name,
				task: options.context.task,
			});
		} else if (testState.spawnBehavior === "error") {
			options.onError(testState.errorMessage);
		} else if (testState.spawnBehavior === "manual") {
			testState.pendingSettlers.push({
				agent: options.context.agent.name,
				settle: () =>
					options.onSettled({
						finalOutput: testState.settledOutput,
						sessionDir: testState.settledSessionDir,
						agent: options.context.agent.name,
						task: options.context.task,
					}),
				fail: () => options.onError(testState.errorMessage),
			});
		}
		return {
			agent: options.context.agent.name,
			sessionDir: testState.settledSessionDir,
			proc: {} as unknown as ChildProcess,
		};
	},
}));

const { createBackgroundCommandHandler } = await import("./background.ts");

function makeCtx() {
	return {
		cwd: "/repo",
		model: { provider: "test-provider" },
		ui: { notify: vi.fn() },
	};
}

function makePi(): { sendUserMessage: ReturnType<typeof vi.fn> } {
	return { sendUserMessage: vi.fn() };
}

beforeEach(() => {
	testState.spawnCalls.length = 0;
	testState.spawnBehavior = "settle";
	testState.settledOutput = "task complete";
	testState.settledSessionDir = "/tmp/pi-subagent-bg-xyz";
	testState.errorMessage = "child crashed";
	testState.pendingSettlers.length = 0;
});

describe("/subagent-bg RPC settlement and result propagation", () => {
	it("starts a background agent and reports the resumable session dir", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("do the thing", ctx);

		expect(testState.spawnCalls).toHaveLength(1);
		expect(testState.spawnCalls[0]?.context.agent.name).toBe("general");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining(testState.settledSessionDir),
			"info",
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("pi --session-dir <dir> --resume"),
			"info",
		);
	});

	it("injects the settled result via sendUserMessage as a follow-up", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("do the thing", ctx);

		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("task complete"),
			{ deliverAs: "followUp" },
		);
		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining(testState.settledSessionDir),
			{ deliverAs: "followUp" },
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining('"general" settled'),
			"info",
		);
	});

	it("propagates a background failure via sendUserMessage and notify, without a settlement message", async () => {
		testState.spawnBehavior = "error";
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("do the thing", ctx);

		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(pi.sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining(testState.errorMessage),
			{ deliverAs: "followUp" },
		);
		expect(ctx.ui.notify).not.toHaveBeenCalledWith(
			expect.stringContaining("settled"),
			"info",
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining(testState.errorMessage),
			"error",
		);
	});

	it("resolves an explicit agent: prefix to the requested agent", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("agent:explore look around", ctx);

		expect(testState.spawnCalls[0]?.context.agent.name).toBe("explore");
		expect(testState.spawnCalls[0]?.context.task).toBe("look around");
	});

	it("rejects an unknown agent before spawning", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("agent:nonexistent do it", ctx);

		expect(testState.spawnCalls).toHaveLength(0);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Unknown agent"),
			"error",
		);
	});

	it("requires a non-empty brief", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("   ", ctx);

		expect(testState.spawnCalls).toHaveLength(0);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("/subagent-bg needs a brief"),
			"error",
		);
	});
});

describe("/subagent-bg parallel/multi-task mode", () => {
	it("spawns one background agent per non-empty line", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("agent:general do a\nagent:explore do b", ctx);

		expect(testState.spawnCalls).toHaveLength(2);
		expect(testState.spawnCalls[0]?.context.agent.name).toBe("general");
		expect(testState.spawnCalls[0]?.context.task).toBe("do a");
		expect(testState.spawnCalls[1]?.context.agent.name).toBe("explore");
		expect(testState.spawnCalls[1]?.context.task).toBe("do b");
	});

	it("injects each task's settled result independently", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("agent:general do a\nagent:explore do b", ctx);

		expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining('"general"'),
			"info",
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining('"explore"'),
			"info",
		);
	});

	it("rejects a batch larger than the parallel task limit without spawning anything", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);
		const lines = Array.from({ length: 9 }, (_, i) => `agent:general task ${i}`);

		await handler(lines.join("\n"), ctx);

		expect(testState.spawnCalls).toHaveLength(0);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Too many background tasks"),
			"error",
		);
	});

	it("skips unknown agents in a batch but still spawns the valid ones", async () => {
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);

		await handler("agent:nonexistent bad\nagent:general good", ctx);

		expect(testState.spawnCalls).toHaveLength(1);
		expect(testState.spawnCalls[0]?.context.agent.name).toBe("general");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Unknown agent"),
			"error",
		);
	});

	it("queues tasks beyond the concurrency cap and starts the next one as each settles", async () => {
		testState.spawnBehavior = "manual";
		const pi = makePi();
		const ctx = makeCtx();
		const handler = createBackgroundCommandHandler(pi as unknown as ExtensionAPI);
		const lines = Array.from({ length: 6 }, (_, i) => `agent:general task ${i}`);

		const done = handler(lines.join("\n"), ctx);

		// Only the concurrency cap (4) should be spawned up front.
		await Promise.resolve();
		expect(testState.spawnCalls).toHaveLength(4);

		testState.pendingSettlers[0]?.settle();
		await Promise.resolve();
		expect(testState.spawnCalls).toHaveLength(5);

		testState.pendingSettlers[1]?.fail();
		await Promise.resolve();
		expect(testState.spawnCalls).toHaveLength(6);

		for (const settler of testState.pendingSettlers.slice(2)) {
			settler.settle();
		}
		await done;
	});
});
