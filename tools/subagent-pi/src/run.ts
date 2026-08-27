/**
 * Child-process mechanics for subagents (forked from pi's example subagent extension).
 *
 * Fork changes over the example:
 *  - spawnBackgroundAgent(): the async detached-RPC background command (extension-fit
 *    research gap 1) — spawns a detached `pi --mode rpc --session-dir <dir>` child,
 *    drives it with the prompt command, and fires onSettled on agent_settled so the
 *    parent can inject the result via sendUserMessage.
 *
 * Launch config resolution (agent discovery, alias resolution, persona overrides)
 * lives in launcher.ts; this module is pure process mechanics.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { emptyUsage, type SingleResult, type SpawnContext } from "./types.ts";

const PER_TASK_OUTPUT_CAP = 50 * 1024;

function createInitialResult(context: SpawnContext): SingleResult {
	return {
		agent: context.agent.name,
		agentSource: context.agent.source,
		task: context.task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		...(context.effective.model ? { model: context.effective.model } : {}),
	};
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg || msg.role !== "assistant") {
			continue;
		}
		for (const part of msg.content) {
			if (typeof part !== "string" && part.type === "text") {
				return part.text;
			}
		}
	}
	return "";
}

export function isFailedResult(result: SingleResult): boolean {
	return (
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted" ||
		Boolean(result.errorMessage)
	);
}

export function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return (
			result.errorMessage ||
			result.stderr ||
			getFinalOutput(result.messages) ||
			"(no output)"
		);
	}
	return getFinalOutput(result.messages) || "(no output)";
}

export function truncateOutput(output: string): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) {
		return output;
	}

	let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

export type OnUpdate = (
	partial: AgentToolResult<{
		results: SingleResult[];
	}>,
) => void;

export interface RunSingleAgentOptions {
	context: SpawnContext;
	signal?: AbortSignal | undefined;
	onUpdate: OnUpdate;
	/** Per-task watchdog: abort the child if it hasn't settled within this many ms. */
	timeoutMs?: number | undefined;
}

/** Build child CLI args from the complete spawn context. */
function buildChildArgs(
	context: SpawnContext,
	includeTask: boolean,
): { args: string[]; tmpDir: string | null; tmpFilePath: string | null } {
	const { agent, effective } = context;
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (effective.provider) {
		args.push("--provider", effective.provider);
	}
	if (effective.model) {
		args.push("--model", effective.model);
	}
	if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}
	if (effective.thinking) {
		args.push("--thinking", effective.thinking);
	}

	let tmpDir: string | null = null;
	let tmpFilePath: string | null = null;
	if (agent.systemPrompt.trim()) {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		const safeName = agent.name.replace(/[^\w.-]+/g, "_");
		tmpFilePath = path.join(tmpDir, `prompt-${safeName}.md`);
		fs.writeFileSync(tmpFilePath, agent.systemPrompt, {
			encoding: "utf-8",
			mode: 0o600,
		});
		args.push("--append-system-prompt", tmpFilePath);
	}

	if (includeTask) {
		args.push(`Task: ${context.task}`);
	}
	return { args, tmpDir, tmpFilePath };
}

export interface AgentEvent {
	type?: string;
	message?: unknown;
	[key: string]: unknown;
}

export interface AgentEventProcessor {
	result: SingleResult;
	processEvent(event: unknown): void;
	processLine(line: string): void;
	processChunk(chunk: string): void;
	flush(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function cleanupPromptFiles(
	tmpFilePath: string | null,
	tmpDir: string | null,
): void {
	if (tmpFilePath) {
		try {
			fs.unlinkSync(tmpFilePath);
		} catch {
			/* ignore */
		}
	}
	if (tmpDir) {
		try {
			fs.rmdirSync(tmpDir);
		} catch {
			/* ignore */
		}
	}
}

/** Parse and apply child JSON events consistently across every execution mode. */
export function createAgentEventProcessor(
	result: SingleResult,
	onUpdate?: (partial: AgentToolResult<{ results: SingleResult[] }>) => void,
	onEvent?: (event: AgentEvent) => void,
): AgentEventProcessor {
	let buffer = "";

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [
					{
						type: "text",
						text: getFinalOutput(result.messages) || "(running...)",
					},
				],
				details: { results: [result] },
			});
		}
	};

	const processEvent = (value: unknown) => {
		if (!isRecord(value)) {
			return;
		}
		const event = value as AgentEvent;
		const message = event.message as Message | undefined;

		if (event.type === "message_end" && message) {
			result.messages.push(message);
			if (message.role === "assistant") {
				result.usage.turns++;
				const usage = message.usage;
				if (usage) {
					result.usage.input += usage.input || 0;
					result.usage.output += usage.output || 0;
					result.usage.cacheRead += usage.cacheRead || 0;
					result.usage.cacheWrite += usage.cacheWrite || 0;
					result.usage.cost += usage.cost.total || 0;
					result.usage.contextTokens = usage.totalTokens || 0;
				}
				if (!result.model && message.model) {
					result.model = message.model;
				}
				if (message.stopReason) {
					result.stopReason = message.stopReason;
				}
				// Reflects only the latest turn's error state (mirrors stopReason
				// below) so a recovered agent isn't misclassified as failed by a
				// stale errorMessage from an earlier, non-terminal turn.
				result.errorMessage = message.errorMessage;
			}
			emitUpdate();
		}

		if (event.type === "tool_result_end" && message) {
			result.messages.push(message);
			emitUpdate();
		}

		onEvent?.(event);
	};

	const processLine = (line: string) => {
		if (!line.trim()) {
			return;
		}
		try {
			processEvent(JSON.parse(line));
		} catch {
			// Child stderr and non-JSON output are intentionally ignored here.
		}
	};

	return {
		result,
		processEvent,
		processLine,
		processChunk(chunk) {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				processLine(line);
			}
		},
		flush() {
			if (buffer.trim()) {
				processLine(buffer);
			}
			buffer = "";
		},
	};
}

/** Distinguishes a per-task watchdog timeout from a user/caller-initiated abort. */
export class SubagentTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Subagent timed out after ${timeoutMs}ms`);
		this.name = "SubagentTimeoutError";
	}
}

export async function runSingleAgent(
	options: RunSingleAgentOptions,
): Promise<SingleResult> {
	const { context, signal, onUpdate, timeoutMs } = options;
	const { args, tmpDir, tmpFilePath } = buildChildArgs(context, true);
	const result = createInitialResult(context);
	const events = createAgentEventProcessor(result, onUpdate);

	try {
		let wasAborted = false;
		let timedOutAfterMs: number | undefined;
		let exited = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: context.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			proc.stdout.on("data", (data) => {
				events.processChunk(String(data));
			});
			proc.stderr.on("data", (data) => {
				result.stderr += String(data);
			});

			const killProc = (timedOutMs?: number) => {
				if (wasAborted) {
					return;
				}
				wasAborted = true;
				timedOutAfterMs = timedOutMs;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!exited) {
						proc.kill("SIGKILL");
					}
				}, 5000);
			};

			let watchdog: ReturnType<typeof setTimeout> | undefined;
			proc.on("close", (code) => {
				exited = true;
				if (watchdog) {
					clearTimeout(watchdog);
				}
				events.flush();
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				exited = true;
				if (watchdog) {
					clearTimeout(watchdog);
				}
				resolve(1);
			});

			if (signal) {
				const onAbort = () => killProc();
				if (signal.aborted) {
					killProc();
				} else {
					signal.addEventListener("abort", onAbort, { once: true });
				}
			}

			if (timeoutMs !== undefined) {
				watchdog = setTimeout(() => killProc(timeoutMs), timeoutMs);
			}
		});

		result.exitCode = exitCode;
		if (timedOutAfterMs !== undefined) {
			throw new SubagentTimeoutError(timedOutAfterMs);
		}
		if (wasAborted) {
			throw new Error("Subagent was aborted");
		}
		return result;
	} finally {
		cleanupPromptFiles(tmpFilePath, tmpDir);
	}
}

export interface BackgroundAgentOptions {
	context: SpawnContext;
	onSettled: (info: {
		finalOutput: string;
		sessionDir: string;
		agent: string;
		task: string;
	}) => void;
	onError: (error: string) => void;
}

export interface BackgroundAgentHandle {
	agent: string;
	sessionDir: string;
	proc: ChildProcess;
}

/**
 * Spawn a detached `pi --mode rpc` child for background/AFK work.
 *
 * The child keeps its own isolated context in a session file under `sessionDir`
 * (resumable via `pi --session-dir <dir> --resume`). The prompt is delivered over
 * stdin; `agent_settled` marks completion and fires `onSettled` with the final
 * assistant text — the parent then injects the result via `pi.sendUserMessage`.
 * `proc.unref()` lets the parent session exit without killing the child.
 */
export function spawnBackgroundAgent(
	options: BackgroundAgentOptions,
): BackgroundAgentHandle {
	const { context, onSettled, onError } = options;
	const { agent, task, cwd } = context;

	const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-bg-"));
	const { args, tmpDir, tmpFilePath } = buildChildArgs(context, false);

	// RPC child: rpc mode + session-dir (resumability); drop the json/-p flags from buildChildArgs
	const rpcArgs = args
		.filter(
			(a) =>
				a !== "--mode" && a !== "json" && a !== "-p" && a !== "--no-session",
		)
		.concat([
			"--mode",
			"rpc",
			"--session-dir",
			sessionDir,
			"--name",
			agent.name,
		]);

	const invocation = getPiInvocation(rpcArgs);
	const proc = spawn(invocation.command, invocation.args, {
		cwd,
		shell: false,
		detached: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	proc.unref();

	let settled = false;
	const result = createInitialResult(context);
	const events = createAgentEventProcessor(result, undefined, (event) => {
		if (event.type === "agent_settled" && !settled) {
			settled = true;
			cleanupPromptFiles(tmpFilePath, tmpDir);
			onSettled({
				finalOutput: getFinalOutput(result.messages),
				sessionDir,
				agent: agent.name,
				task,
			});
		}
	});

	proc.stdout.on("data", (data) => {
		events.processChunk(String(data));
	});

	proc.stderr.on("data", (data) => {
		events.processLine(String(data));
	});

	proc.on("error", (err) => {
		onError(err.message);
	});

	proc.on("exit", (code) => {
		events.flush();
		if (!settled) {
			onError(`Background subagent exited with code ${code} before settling`);
		}
	});

	// Deliver the prompt; the child starts working immediately.
	proc.stdin.write(JSON.stringify({ type: "prompt", message: task }) + "\n");

	return { agent: agent.name, sessionDir, proc };
}
