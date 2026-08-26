import { isFailedResult } from "./run.ts";
import { emptyUsage, type SingleResult } from "./types.ts";

export const MAX_PARALLEL_TASKS = 8;
export const PARALLEL_CONCURRENCY = 4;
/** Default watchdog bound for a single task in a parallel batch: 10 minutes. */
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

export type ParallelTaskStatus =
	"queued" | "running" | "completed" | "failed" | "cancelled";

export interface ParallelRunTask {
	agent: string;
	task: string;
	cwd?: string;
	/** Per-task watchdog override; takes precedence over taskTimeoutMs and the default. */
	timeoutMs?: number;
}

export interface ParallelTaskEntry {
	readonly task: ParallelRunTask;
	readonly status: ParallelTaskStatus;
	readonly result?: SingleResult;
}

export interface ParallelRunCounts {
	readonly queued: number;
	readonly running: number;
	readonly completed: number;
	readonly failed: number;
	readonly cancelled: number;
}

export interface ParallelRunSnapshot {
	readonly entries: readonly ParallelTaskEntry[];
	readonly counts: ParallelRunCounts;
}

export type ParallelTaskRunner = (
	task: ParallelRunTask,
	onUpdate: (result: SingleResult) => void,
	timeoutMs: number,
) => Promise<SingleResult>;

export class ParallelRunLimitError extends Error {
	readonly taskCount: number;
	readonly maxTasks: number;

	constructor(taskCount: number, maxTasks: number) {
		super(`Too many parallel tasks (${taskCount}). Max is ${maxTasks}.`);
		this.name = "ParallelRunLimitError";
		this.taskCount = taskCount;
		this.maxTasks = maxTasks;
	}
}

export interface RunParallelOptions {
	tasks: readonly ParallelRunTask[];
	runTask: ParallelTaskRunner;
	signal?: AbortSignal;
	onUpdate?: (snapshot: ParallelRunSnapshot) => void;
	maxTasks?: number;
	concurrency?: number;
	/** Per-call default watchdog for every task that doesn't set its own timeoutMs. */
	taskTimeoutMs?: number;
}

interface MutableParallelTaskEntry {
	task: ParallelRunTask;
	status: ParallelTaskStatus;
	result?: SingleResult;
}

function cloneResult(result: SingleResult): SingleResult {
	const messages = Object.freeze([
		...result.messages,
	]) as unknown as SingleResult["messages"];
	const usage = Object.freeze({ ...result.usage });
	return Object.freeze({
		...result,
		messages,
		usage,
	});
}

interface MutableParallelRunCounts {
	queued: number;
	running: number;
	completed: number;
	failed: number;
	cancelled: number;
}

function snapshotResult(
	entries: readonly MutableParallelTaskEntry[],
): ParallelRunSnapshot {
	const copiedEntries = entries.map((entry) =>
		Object.freeze({
			task: Object.freeze({ ...entry.task }),
			status: entry.status,
			...(entry.result ? { result: cloneResult(entry.result) } : {}),
		}),
	);
	const counts = copiedEntries.reduce<MutableParallelRunCounts>(
		(counts, entry) => {
			counts[entry.status]++;
			return counts;
		},
		{ queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
	);

	return Object.freeze({
		entries: Object.freeze(copiedEntries),
		counts: Object.freeze(counts),
	});
}

function isRunningEntry(entry: MutableParallelTaskEntry): boolean {
	return entry.status === "running";
}

function isCancellationRequested(
	cancelled: boolean,
	signal: AbortSignal | undefined,
): boolean {
	return cancelled || Boolean(signal?.aborted);
}

function failedResult(task: ParallelRunTask, error: unknown): SingleResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		agent: task.agent,
		agentSource: "unknown",
		task: task.task,
		exitCode: 1,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		stopReason: "error",
		errorMessage: message,
	};
}

/**
 * Run a bounded collection of agent tasks and publish immutable lifecycle
 * snapshots. Process mechanics stay in the supplied single-task runner.
 */
export async function runParallelRun(
	options: RunParallelOptions,
): Promise<ParallelRunSnapshot> {
	const maxTasks = options.maxTasks ?? MAX_PARALLEL_TASKS;
	const concurrency = options.concurrency ?? PARALLEL_CONCURRENCY;
	if (options.tasks.length > maxTasks) {
		throw new ParallelRunLimitError(options.tasks.length, maxTasks);
	}

	const entries: MutableParallelTaskEntry[] = options.tasks.map((task) => ({
		task: { ...task },
		status: "queued",
	}));
	let nextIndex = 0;
	let cancelled = options.signal?.aborted ?? false;

	const emit = () => {
		const snapshot = snapshotResult(entries);
		if (options.onUpdate) {
			options.onUpdate(snapshot);
		}
	};

	const cancelQueued = () => {
		let changed = false;
		cancelled = true;
		for (const entry of entries) {
			if (entry.status === "queued") {
				entry.status = "cancelled";
				changed = true;
			}
		}
		if (changed) {
			emit();
		}
	};

	const abortHandler = () => {
		cancelQueued();
	};
	options.signal?.addEventListener("abort", abortHandler, { once: true });

	emit();
	if (cancelled) {
		cancelQueued();
	}

	const worker = async () => {
		while (!cancelled && nextIndex < entries.length) {
			const index = nextIndex++;
			const entry = entries[index];
			if (!entry) {
				return;
			}
			if (entry.status !== "queued") {
				continue;
			}
			entry.status = "running";
			emit();

			const update = (partial: SingleResult) => {
				if (!isRunningEntry(entry)) {
					return;
				}
				entry.result = cloneResult(partial);
				emit();
			};

			const timeoutMs =
				entry.task.timeoutMs ??
				options.taskTimeoutMs ??
				DEFAULT_TASK_TIMEOUT_MS;

			try {
				const result = await options.runTask(entry.task, update, timeoutMs);
				if (!isRunningEntry(entry)) {
					continue;
				}
				if (isCancellationRequested(cancelled, options.signal)) {
					entry.status = "cancelled";
					emit();
					continue;
				}
				entry.result = cloneResult(result);
				entry.status = isFailedResult(result) ? "failed" : "completed";
				emit();
			} catch (error) {
				if (!isRunningEntry(entry)) {
					continue;
				}
				if (isCancellationRequested(cancelled, options.signal)) {
					entry.status = "cancelled";
					emit();
					continue;
				}
				entry.result = failedResult(entry.task, error);
				entry.status = "failed";
				emit();
			}
		}
	};

	const workerCount = Math.max(1, Math.min(concurrency, entries.length || 1));
	try {
		await Promise.all(new Array(workerCount).fill(null).map(() => worker()));
	} finally {
		options.signal?.removeEventListener("abort", abortHandler);
	}

	return snapshotResult(entries);
}
