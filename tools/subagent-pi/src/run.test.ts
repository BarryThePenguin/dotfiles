import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import {
	createAgentEventProcessor,
	getFinalOutput,
	type SingleResult,
} from "./run.ts";

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
