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
import {
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
