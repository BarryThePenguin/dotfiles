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
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
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
	defaultCwd: string;
	agents: AgentConfig[];
	agentName: string;
	task: string;
	cwd?: string | undefined;
	signal?: AbortSignal | undefined;
	onUpdate?:
		| ((partial: AgentToolResult<{ results: SingleResult[] }>) => void)
		| undefined;
	overrides: Map<string, PersonaOverride>;
	parentProvider?: string | undefined;
}

/** Build child CLI args: mode/scope flags + provider/model/tools/thinking passthrough + system prompt. */
function buildChildArgs(
	agent: AgentConfig,
	effective: EffectiveSpawnConfig,
	systemPrompt: string,
	task: string,
): { args: string[]; tmpDir: string | null; tmpFilePath: string | null } {
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
	if (systemPrompt.trim()) {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
		const safeName = agent.name.replace(/[^\w.-]+/g, "_");
		tmpFilePath = path.join(tmpDir, `prompt-${safeName}.md`);
		fs.writeFileSync(tmpFilePath, systemPrompt, {
			encoding: "utf-8",
			mode: 0o600,
		});
		args.push("--append-system-prompt", tmpFilePath);
	}

	args.push(`Task: ${task}`);
	return { args, tmpDir, tmpFilePath };
}

export async function runSingleAgent(
	options: RunSingleAgentOptions,
): Promise<SingleResult> {
	const {
		defaultCwd,
		agents,
		agentName,
		task,
		cwd,
		signal,
		onUpdate,
		overrides,
		parentProvider,
	} = options;
	const resolvedName = resolveAgentName(agentName);
	const agent = agents.find((a) => a.name === resolvedName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
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

	const effective = effectiveSpawnConfig(agent, overrides, parentProvider);
	const { args, tmpDir, tmpFilePath } = buildChildArgs(
		agent,
		effective,
		agent.systemPrompt,
		task,
	);

	const currentResult: SingleResult = {
		agent: resolvedName,
		agentSource: agent.source,
		task,
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
		...(effective.model ? { model: effective.model } : {}),
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [
					{
						type: "text",
						text: getFinalOutput(currentResult.messages) || "(running...)",
					},
				],
				details: { results: [currentResult] },
			});
		}
	};

	try {
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) {
					return;
				}
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) {
							currentResult.model = msg.model;
						}
						if (msg.stopReason) {
							currentResult.stopReason = msg.stopReason;
						}
						if (msg.errorMessage) {
							currentResult.errorMessage = msg.errorMessage;
						}
					}
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					processLine(line);
				}
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) {
					processLine(buffer);
				}
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

		currentResult.exitCode = exitCode;
		if (wasAborted) {
			throw new Error("Subagent was aborted");
		}
		return currentResult;
	} finally {
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
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) {
		return [];
	}
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) {
				return;
			}
			results[current] = await fn(items[current]!, current);
		}
	});
	await Promise.all(workers);
	return results;
}

export interface BackgroundAgentOptions {
	agent: AgentConfig;
	task: string;
	cwd: string;
	overrides: Map<string, PersonaOverride>;
	parentProvider?: string | undefined;
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
	const { agent, task, cwd, overrides, parentProvider, onSettled, onError } =
		options;

	const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-bg-"));
	const effective = effectiveSpawnConfig(agent, overrides, parentProvider);
	const { args, tmpDir, tmpFilePath } = buildChildArgs(
		agent,
		effective,
		agent.systemPrompt,
		"",
	);

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

	let buffer = "";
	let settled = false;
	let lastAssistantText = "";

	const processLine = (line: string) => {
		if (!line.trim()) {
			return;
		}
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}

		if (event.type === "message_end" && event.message?.role === "assistant") {
			for (const part of event.message.content ?? []) {
				if (part.type === "text") {
					lastAssistantText = part.text;
				}
			}
		}

		if (event.type === "agent_settled" && !settled) {
			settled = true;
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
			onSettled({
				finalOutput: lastAssistantText,
				sessionDir,
				agent: agent.name,
				task,
			});
		}
	};

	proc.stdout.on("data", (data) => {
		buffer += data.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";
		for (const line of lines) {
			processLine(line);
		}
	});

	proc.stderr.on("data", (data) => {
		processLine(data.toString());
	});

	proc.on("error", (err) => {
		onError(err.message);
	});

	proc.on("exit", (code) => {
		if (!settled) {
			if (buffer.trim()) {
				processLine(buffer);
			}
			if (!settled) {
				onError(`Background subagent exited with code ${code} before settling`);
			}
		}
	});

	// Deliver the prompt; the child starts working immediately.
	proc.stdin.write(JSON.stringify({ type: "prompt", message: task }) + "\n");

	return { agent: agent.name, sessionDir, proc };
}
