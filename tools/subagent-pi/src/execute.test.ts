import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSubagent } from "./execute.ts";
import type { SingleResult } from "./types.ts";

const testState = vi.hoisted(() => ({
	rosterAgents: [
		{ name: "general", source: "user" as const },
		{ name: "explore", source: "user" as const },
	],
	runResults: new Map<string, SingleResult | Error>(),
	runCalls: [] as Array<{
		agent: string;
		task: string;
		cwd: string | undefined;
		allowFallback: boolean | undefined;
		timeoutMs: number | undefined;
	}>,
}));

vi.mock("./launcher.ts", () => ({
	createLauncher: () => ({
		agents: testState.rosterAgents,
		resolve: () => {
			throw new Error(
				"launcher.resolve should not be called directly in execute.ts tests",
			);
		},
	}),
	loadLauncherDeps: () => ({ agents: [], overrides: new Map() }),
}));

vi.mock("./agent-runner.ts", () => ({
	createAgentRunner: () => ({
		async run(
			agentName: string,
			task: string,
			onUpdate: (partial: SingleResult) => void,
			cwd?: string,
			allowFallback?: boolean,
			timeoutMs?: number,
		) {
			testState.runCalls.push({
				agent: agentName,
				task,
				cwd,
				allowFallback,
				timeoutMs,
			});
			const outcome = testState.runResults.get(`${agentName}:${task}`);
			if (!outcome) {
				throw new Error(`no stubbed outcome for ${agentName}:${task}`);
			}
			if (outcome instanceof Error) {
				throw outcome;
			}
			onUpdate(outcome);
			return outcome;
		},
	}),
}));

function successResult(
	agent: string,
	task: string,
	text: string,
): SingleResult {
	return {
		agent,
		agentSource: "user",
		task,
		exitCode: 0,
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text }],
			} as SingleResult["messages"][number],
		],
		stderr: "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
		stopReason: "end",
	};
}

function failedResult(
	agent: string,
	task: string,
	errorMessage: string,
): SingleResult {
	return {
		agent,
		agentSource: "user",
		task,
		exitCode: 1,
		messages: [],
		stderr: "",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		},
		stopReason: "error",
		errorMessage,
	};
}

const ctx = { cwd: "/repo" };

beforeEach(() => {
	testState.runResults.clear();
	testState.runCalls.length = 0;
});

describe("executeSubagent single mode", () => {
	it("runs a single agent invocation end to end and surfaces final output", async () => {
		testState.runResults.set(
			"general:say hi",
			successResult("general", "say hi", "hello there"),
		);

		const outcome = await executeSubagent(
			"call-1",
			{ agent: "general", task: "say hi" },
			undefined,
			undefined,
			ctx,
		);

		expect(outcome.isError).toBeFalsy();
		expect(outcome.content[0]?.text).toBe("hello there");
		expect(outcome.details.mode).toBe("single");
		expect(outcome.details.results).toHaveLength(1);
		expect(testState.runCalls).toEqual([
			{
				agent: "general",
				task: "say hi",
				cwd: undefined,
				allowFallback: undefined,
				timeoutMs: undefined,
			},
		]);
	});

	it("reports a failed single-agent run as an error result", async () => {
		testState.runResults.set(
			"general:break",
			failedResult("general", "break", "boom"),
		);

		const outcome = await executeSubagent(
			"call-2",
			{ agent: "general", task: "break" },
			undefined,
			undefined,
			ctx,
		);

		expect(outcome.isError).toBe(true);
		expect(outcome.content[0]?.text).toContain("boom");
		expect(outcome.details.results[0]?.errorMessage).toBe("boom");
	});

	it("streams partial updates via onUpdate", async () => {
		testState.runResults.set(
			"general:stream",
			successResult("general", "stream", "final text"),
		);
		const updates: unknown[] = [];

		await executeSubagent(
			"call-3",
			{ agent: "general", task: "stream" },
			undefined,
			(update) => updates.push(update),
			ctx,
		);

		expect(updates).toHaveLength(1);
	});
});

describe("executeSubagent parallel mode", () => {
	it("fans out concurrent tasks and reports partial failures", async () => {
		testState.runResults.set(
			"general:ok",
			successResult("general", "ok", "all good"),
		);
		testState.runResults.set(
			"explore:bad",
			failedResult("explore", "bad", "exploded"),
		);

		const outcome = await executeSubagent(
			"call-4",
			{
				tasks: [
					{ agent: "general", task: "ok" },
					{ agent: "explore", task: "bad" },
				],
			},
			undefined,
			undefined,
			ctx,
		);

		expect(outcome.details.mode).toBe("parallel");
		expect(outcome.details.snapshot?.counts).toEqual({
			queued: 0,
			running: 0,
			completed: 1,
			failed: 1,
			cancelled: 0,
		});
		expect(outcome.content[0]?.text).toContain("1/2 succeeded");
		expect(outcome.content[0]?.text).toContain("1 failed");
		expect(outcome.content[0]?.text).toContain("all good");
		expect(outcome.content[0]?.text).toContain("exploded");
	});

	it("applies the default per-task timeout to parallel tasks that don't override it", async () => {
		testState.runResults.set(
			"general:ok",
			successResult("general", "ok", "all good"),
		);

		await executeSubagent(
			"call-timeout-default",
			{ tasks: [{ agent: "general", task: "ok" }] },
			undefined,
			undefined,
			ctx,
		);

		expect(testState.runCalls[0]?.timeoutMs).toBe(10 * 60 * 1000);
	});

	it("forwards a per-call taskTimeoutMs override to every task", async () => {
		testState.runResults.set(
			"general:ok",
			successResult("general", "ok", "all good"),
		);
		testState.runResults.set(
			"explore:bad",
			failedResult("explore", "bad", "exploded"),
		);

		await executeSubagent(
			"call-timeout-override",
			{
				tasks: [
					{ agent: "general", task: "ok" },
					{ agent: "explore", task: "bad" },
				],
				taskTimeoutMs: 5000,
			},
			undefined,
			undefined,
			ctx,
		);

		expect(testState.runCalls.map((call) => call.timeoutMs)).toEqual([
			5000, 5000,
		]);
	});

	it("lets a per-task timeoutMs override the per-call default", async () => {
		testState.runResults.set(
			"general:ok",
			successResult("general", "ok", "all good"),
		);

		await executeSubagent(
			"call-timeout-per-task",
			{
				tasks: [{ agent: "general", task: "ok", timeoutMs: 1234 }],
				taskTimeoutMs: 5000,
			},
			undefined,
			undefined,
			ctx,
		);

		expect(testState.runCalls[0]?.timeoutMs).toBe(1234);
	});

	it("publishes progress snapshots through onUpdate while running", async () => {
		testState.runResults.set(
			"general:a",
			successResult("general", "a", "a-done"),
		);
		testState.runResults.set(
			"general:b",
			successResult("general", "b", "b-done"),
		);
		const progressTexts: string[] = [];

		await executeSubagent(
			"call-5",
			{
				tasks: [
					{ agent: "general", task: "a" },
					{ agent: "general", task: "b" },
				],
			},
			undefined,
			(update) => {
				const text = update.content[0]?.text;
				if (typeof text === "string") {
					progressTexts.push(text);
				}
			},
			ctx,
		);

		expect(progressTexts.some((text) => text.startsWith("Parallel:"))).toBe(
			true,
		);
	});

	it("reports the parallel task limit as tool output instead of throwing", async () => {
		const tasks = Array.from({ length: 9 }, (_, index) => ({
			agent: "general",
			task: `task-${index}`,
		}));

		const outcome = await executeSubagent(
			"call-oversized",
			{ tasks },
			undefined,
			undefined,
			ctx,
		);

		expect(outcome.details.mode).toBe("parallel");
		expect(outcome.details.results).toEqual([]);
		expect(outcome.content[0]?.text).toContain("Too many parallel tasks (9)");
		expect(outcome.content[0]?.text).toContain("Max is 8");
		expect(testState.runCalls).toHaveLength(0);
	});
});

describe("executeSubagent invalid parameters", () => {
	it("lists available agents when neither mode is requested", async () => {
		const outcome = await executeSubagent(
			"call-6",
			{},
			undefined,
			undefined,
			ctx,
		);

		expect(outcome.content[0]?.text).toContain("Invalid parameters");
		expect(outcome.content[0]?.text).toContain("general (user)");
		expect(outcome.content[0]?.text).toContain("explore (user)");
	});

	it("rejects requests that specify both single and parallel modes", async () => {
		testState.runResults.set(
			"general:solo",
			successResult("general", "solo", "solo-done"),
		);

		const outcome = await executeSubagent(
			"call-7",
			{
				agent: "general",
				task: "solo",
				tasks: [{ agent: "general", task: "solo" }],
			},
			undefined,
			undefined,
			ctx,
		);

		expect(outcome.content[0]?.text).toContain("Provide exactly one mode");
	});
});
