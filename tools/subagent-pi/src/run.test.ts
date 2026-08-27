import { EventEmitter } from "node:events";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import {
	buildCommonChildArgs,
	createAgentEventProcessor,
	getFinalOutput,
	runSingleAgent,
} from "./run.ts";
import type { SingleResult, SpawnContext } from "./types.ts";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

function result(): SingleResult {
	return {
		agent: "general",
		agentSource: "user",
		task: "Review this",
		exitCode: 0,
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
	};
}

const assistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "The final answer" }],
	api: "openai-completions",
	provider: "test",
	model: "test-model",
	usage: {
		input: 10,
		output: 20,
		cacheRead: 3,
		cacheWrite: 4,
		totalTokens: 30,
		cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
	},
	stopReason: "end",
} as unknown as Message;

const toolMessage = {
	role: "toolResult",
	content: [{ type: "text", text: "tool output" }],
} as unknown as Message;

describe("agent event processing", () => {
	it("shares JSON parsing, result collection, usage, and updates", () => {
		const current = result();
		const updates: unknown[] = [];
		const processor = createAgentEventProcessor(current, (update) => {
			updates.push(update);
		});

		const assistantEvent = JSON.stringify({
			type: "message_end",
			message: assistantMessage,
		});
		processor.processChunk(assistantEvent.slice(0, 25));
		processor.processChunk(`${assistantEvent.slice(25)}\n`);
		processor.processChunk(
			`${JSON.stringify({ type: "tool_result_end", message: toolMessage })}\n`,
		);
		processor.flush();

		expect(current.messages).toEqual([assistantMessage, toolMessage]);
		expect(current.usage).toEqual({
			input: 10,
			output: 20,
			cacheRead: 3,
			cacheWrite: 4,
			cost: 0.3,
			contextTokens: 30,
			turns: 1,
		});
		expect(current.model).toBe("test-model");
		expect(getFinalOutput(current.messages)).toBe("The final answer");
		expect(current.stopReason).toBe("end");
		expect(updates).toHaveLength(2);
	});

	it("notifies execution-mode-specific handlers without bypassing shared processing", () => {
		const current = result();
		const events: string[] = [];
		const processor = createAgentEventProcessor(current, undefined, (event) => {
			if (event.type) {
				events.push(event.type);
			}
		});

		processor.processLine(
			JSON.stringify({ type: "message_end", message: assistantMessage }),
		);
		processor.processLine(JSON.stringify({ type: "agent_settled" }));

		expect(events).toEqual(["message_end", "agent_settled"]);
		expect(current.messages).toHaveLength(1);
	});

	it("ignores malformed and incomplete non-JSON output", () => {
		const current = result();
		const processor = createAgentEventProcessor(current);

		processor.processChunk('not json\n{"type":"message_end"');
		processor.flush();

		expect(current.messages).toHaveLength(0);
	});

	it("clears a stale errorMessage once a later assistant turn completes without one", () => {
		const current = result();
		const processor = createAgentEventProcessor(current);

		const erroredTurn = {
			...assistantMessage,
			errorMessage: "transient tool failure",
		} as unknown as Message;
		processor.processLine(
			JSON.stringify({ type: "message_end", message: erroredTurn }),
		);
		expect(current.errorMessage).toBe("transient tool failure");

		processor.processLine(
			JSON.stringify({ type: "message_end", message: assistantMessage }),
		);

		expect(current.errorMessage).toBeUndefined();
	});

	it("keeps processing events when the onUpdate callback throws", () => {
		const current = result();
		const processor = createAgentEventProcessor(current, () => {
			throw new Error("progress callback boom");
		});

		expect(() => {
			processor.processLine(
				JSON.stringify({ type: "message_end", message: assistantMessage }),
			);
		}).not.toThrow();

		expect(current.messages).toEqual([assistantMessage]);
	});
});

class FakeChildProcess extends EventEmitter {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	readonly kill = vi.fn((_signal?: string) => true);
}

function buildContext(): SpawnContext {
	return {
		agent: {
			name: "general",
			description: "test agent",
			systemPrompt: "You are a test agent",
			source: "user",
			filePath: "/tmp/agent.md",
		},
		task: "do the thing",
		cwd: "/tmp",
		effective: {},
	};
}

describe("buildCommonChildArgs", () => {
	it("includes no mode-specific flags, only provider/model/tools/thinking", () => {
		const { args, tmpDir } = buildCommonChildArgs({
			...buildContext(),
			agent: { ...buildContext().agent, systemPrompt: "", tools: ["read", "grep"] },
			effective: { provider: "anthropic", model: "sonnet", thinking: "high" },
		});

		expect(args).toEqual([
			"--provider",
			"anthropic",
			"--model",
			"sonnet",
			"--tools",
			"read,grep",
			"--thinking",
			"high",
		]);
		expect(args).not.toContain("--mode");
		expect(args).not.toContain("-p");
		expect(args).not.toContain("--no-session");
		expect(tmpDir).toBeNull();
	});

	it("omits optional flags entirely when unset", () => {
		const { args, tmpDir, tmpFilePath } = buildCommonChildArgs({
			...buildContext(),
			agent: { ...buildContext().agent, systemPrompt: "" },
			effective: {},
		});

		expect(args).toEqual([]);
		expect(tmpDir).toBeNull();
		expect(tmpFilePath).toBeNull();
	});

	it("writes the system prompt to a tmp file and appends --append-system-prompt", () => {
		const { args, tmpDir, tmpFilePath } = buildCommonChildArgs(buildContext());

		try {
			expect(args).toEqual(["--append-system-prompt", tmpFilePath]);
			expect(tmpDir).not.toBeNull();
			expect(fs.readFileSync(tmpFilePath as string, "utf-8")).toBe(
				"You are a test agent",
			);
		} finally {
			if (tmpFilePath) {
				fs.unlinkSync(tmpFilePath);
			}
			if (tmpDir) {
				fs.rmdirSync(tmpDir);
			}
		}
	});
});

describe("runSingleAgent cancellation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("sends SIGTERM immediately and SIGKILL after the grace period if the process has not exited", async () => {
		const { spawn } = await import("node:child_process");
		const proc = new FakeChildProcess();
		vi.mocked(spawn).mockReturnValue(proc as never);

		const controller = new AbortController();
		const run = runSingleAgent({
			context: buildContext(),
			signal: controller.signal,
			onUpdate: () => {},
		});
		run.catch(() => {});

		controller.abort();
		expect(proc.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

		await vi.advanceTimersByTimeAsync(5000);
		expect(proc.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

		proc.emit("close", null);
		await expect(run).rejects.toThrow("Subagent was aborted");
	});

	it("does not send SIGKILL when the process exits before the grace period elapses", async () => {
		const { spawn } = await import("node:child_process");
		const proc = new FakeChildProcess();
		vi.mocked(spawn).mockReturnValue(proc as never);

		const controller = new AbortController();
		const run = runSingleAgent({
			context: buildContext(),
			signal: controller.signal,
			onUpdate: () => {},
		});
		run.catch(() => {});

		controller.abort();
		expect(proc.kill).toHaveBeenCalledTimes(1);

		proc.emit("close", 0);
		await vi.advanceTimersByTimeAsync(5000);

		expect(proc.kill).toHaveBeenCalledTimes(1);
		await expect(run).rejects.toThrow("Subagent was aborted");
	});

	it("does not send SIGKILL when the process errors out before the grace period elapses", async () => {
		const { spawn } = await import("node:child_process");
		const proc = new FakeChildProcess();
		vi.mocked(spawn).mockReturnValue(proc as never);

		const controller = new AbortController();
		const run = runSingleAgent({
			context: buildContext(),
			signal: controller.signal,
			onUpdate: () => {},
		});
		run.catch(() => {});

		controller.abort();
		expect(proc.kill).toHaveBeenCalledTimes(1);

		proc.emit("error", new Error("spawn failed"));
		await vi.advanceTimersByTimeAsync(5000);

		expect(proc.kill).toHaveBeenCalledTimes(1);
		await expect(run).rejects.toThrow("Subagent was aborted");
	});
});

describe("runSingleAgent onUpdate failures", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("still kills the child on abort when the onUpdate callback throws on every event", async () => {
		const { spawn } = await import("node:child_process");
		const proc = new FakeChildProcess();
		vi.mocked(spawn).mockReturnValue(proc as never);

		const controller = new AbortController();
		const run = runSingleAgent({
			context: buildContext(),
			signal: controller.signal,
			onUpdate: () => {
				throw new Error("progress callback boom");
			},
		});
		run.catch(() => {});

		proc.stdout.emit(
			"data",
			`${JSON.stringify({ type: "message_end", message: assistantMessage })}\n`,
		);

		controller.abort();
		expect(proc.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

		await vi.advanceTimersByTimeAsync(5000);
		expect(proc.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

		proc.emit("close", null);
		await expect(run).rejects.toThrow("Subagent was aborted");
	});
});

describe("runSingleAgent per-task timeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("kills a stalled child once the timeout elapses and reports it as timed out, not aborted", async () => {
		const { spawn } = await import("node:child_process");
		const proc = new FakeChildProcess();
		vi.mocked(spawn).mockReturnValue(proc as never);

		const run = runSingleAgent({
			context: buildContext(),
			onUpdate: () => {},
			timeoutMs: 1000,
		});
		run.catch(() => {});

		await vi.advanceTimersByTimeAsync(1000);
		expect(proc.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

		await vi.advanceTimersByTimeAsync(5000);
		expect(proc.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

		proc.emit("close", null);
		await expect(run).rejects.toThrow(/timed out/i);
		await expect(run).rejects.not.toThrow("Subagent was aborted");
	});

	it("does not fire the timeout if the process finishes first", async () => {
		const { spawn } = await import("node:child_process");
		const proc = new FakeChildProcess();
		vi.mocked(spawn).mockReturnValue(proc as never);

		const run = runSingleAgent({
			context: buildContext(),
			onUpdate: () => {},
			timeoutMs: 1000,
		});

		proc.emit("close", 0);
		await vi.advanceTimersByTimeAsync(1000);

		expect(proc.kill).not.toHaveBeenCalled();
		await expect(run).resolves.toMatchObject({ exitCode: 0 });
	});

	it("reports a user abort as aborted (not timed out) when both a signal and a timeout are present", async () => {
		const { spawn } = await import("node:child_process");
		const proc = new FakeChildProcess();
		vi.mocked(spawn).mockReturnValue(proc as never);

		const controller = new AbortController();
		const run = runSingleAgent({
			context: buildContext(),
			signal: controller.signal,
			onUpdate: () => {},
			timeoutMs: 60_000,
		});
		run.catch(() => {});

		controller.abort();
		proc.emit("close", null);

		await expect(run).rejects.toThrow("Subagent was aborted");
	});
});
