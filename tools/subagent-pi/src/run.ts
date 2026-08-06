/**
 * Child-process mechanics for subagents (forked from pi's example subagent extension).
 *
 * Fork changes over the example:
 *  - requested agent names pass through the alias surface (resolveAgentName)
 *  - effective spawn config merges .pi/personas.json overrides; the child spawn
 *    passes --provider and --thinking when set (the example only passed --model)
 *  - spawnBackgroundAgent(): the async detached-RPC background command (extension-fit
 *    research gap 1) — spawns a detached `pi --mode rpc --session-dir <dir>` child,
 *    drives it with the prompt command, and fires onSettled on agent_settled so the
 *    parent can inject the result via sendUserMessage.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { resolveAgentName, type AgentConfig } from "./agents.ts";
import {
	effectiveSpawnConfig,
	type EffectiveSpawnConfig,
	type PersonaOverride,
} from "./personas.ts";

const PER_TASK_OUTPUT_CAP = 50 * 1024;

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "user" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

/** Everything needed to launch one child process. */
export interface SpawnContext {
	agent: AgentConfig;
	task: string;
	cwd: string;
	effective: EffectiveSpawnConfig;
}

export interface SpawnContextOptions {
	agent: AgentConfig;
	task: string;
	cwd: string;
	overrides: Map<string, PersonaOverride>;
	parentProvider?: string | undefined;
}

export interface SpawnContextRequest {
	defaultCwd: string;
	agents: AgentConfig[];
	agentName: string;
	task: string;
	cwd?: string | undefined;
	overrides: Map<string, PersonaOverride>;
	parentProvider?: string | undefined;
}

export type SpawnContextResolution =
	{ context: SpawnContext } | { result: SingleResult };

function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function createSpawnContext(options: SpawnContextOptions): SpawnContext {
	return {
		agent: options.agent,
		task: options.task,
		cwd: options.cwd,
		effective: effectiveSpawnConfig(
			options.agent,
			options.overrides,
			options.parentProvider,
		),
	};
}

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

function createUnknownAgentResult(
	agentName: string,
	task: string,
	agents: AgentConfig[],
): SingleResult {
	const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
	return {
		agent: agentName,
		agentSource: "unknown",
		task,
		exitCode: 1,
		messages: [],
		stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
		usage: emptyUsage(),
	};
}

/** Resolve a requested agent and package its launch settings into one context. */
export function resolveSpawnContext(
	request: SpawnContextRequest,
): SpawnContextResolution {
	const resolvedName = resolveAgentName(request.agentName);
	const agent = request.agents.find(
		(candidate) => candidate.name === resolvedName,
	);
	if (!agent) {
		return {
			result: createUnknownAgentResult(
				request.agentName,
				request.task,
				request.agents,
			),
		};
	}

	return {
		context: createSpawnContext({
			agent,
			task: request.task,
			cwd: request.cwd ?? request.defaultCwd,
			overrides: request.overrides,
			parentProvider: request.parentProvider,
		}),
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
		result.stopReason === "aborted"
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

export interface RunSingleAgentOptions {
	context: SpawnContext;
	signal?: AbortSignal | undefined;
	onUpdate?:
		| ((partial: AgentToolResult<{ results: SingleResult[] }>) => void)
		| undefined;
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
	onUpdate?:
		| ((partial: AgentToolResult<{ results: SingleResult[] }>) => void)
		| undefined,
	onEvent?: ((event: AgentEvent) => void) | undefined,
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
					result.usage.cost += usage.cost?.total || 0;
					result.usage.contextTokens = usage.totalTokens || 0;
				}
				if (!result.model && message.model) {
					result.model = message.model;
				}
				if (message.stopReason) {
					result.stopReason = message.stopReason;
				}
				if (message.errorMessage) {
					result.errorMessage = message.errorMessage;
				}
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

export async function runSingleAgent(
	options: RunSingleAgentOptions,
): Promise<SingleResult> {
	const { context, signal, onUpdate } = options;
	const { args, tmpDir, tmpFilePath } = buildChildArgs(context, true);
	const result = createInitialResult(context);
	const events = createAgentEventProcessor(result, onUpdate);

	try {
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: context.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			proc.stdout.on("data", (data) => events.processChunk(data.toString()));
			proc.stderr.on("data", (data) => {
				result.stderr += data.toString();
			});

			proc.on("close", (code) => {
				events.flush();
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) {
							proc.kill("SIGKILL");
						}
					}, 5000);
				};
				if (signal.aborted) {
					killProc();
				} else {
					signal.addEventListener("abort", killProc, { once: true });
				}
			}
		});

		result.exitCode = exitCode;
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

	proc.stdout.on("data", (data) => events.processChunk(data.toString()));

	proc.stderr.on("data", (data) => events.processLine(data.toString()));

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
