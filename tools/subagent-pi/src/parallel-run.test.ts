import { describe, expect, it } from "vitest";
import {
	MAX_PARALLEL_TASKS,
	ParallelRunLimitError,
	runParallelRun,
	type ParallelRunTask,
} from "./parallel-run.ts";
import type { SingleResult } from "./types.ts";

function result(task: ParallelRunTask, text = task.agent): SingleResult {
	return {
		agent: task.agent,
		agentSource: "user",
		task: task.task,
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
		model: text,
	};
}

function tasks(count: number): ParallelRunTask[] {
	return Array.from({ length: count }, (_, index) => ({
		agent: `agent-${index}`,
		task: `task-${index}`,
	}));
}

function waitFor(predicate: () => boolean): Promise<void> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + 1000;
		const check = () => {
			if (predicate()) {
				resolve();
				return;
			}
			if (Date.now() >= deadline) {
				reject(new Error("Timed out waiting for test condition"));
				return;
			}
			setTimeout(check, 1);
		};
		check();
	});
}

describe("parallel run", () => {
	it("keeps input order while enforcing bounded concurrency", async () => {
		const input = tasks(5);
		let active = 0;
		let maximumActive = 0;
		const delays = [20, 1, 8, 2, 4];

		const snapshot = await runParallelRun({
			tasks: input,
			concurrency: 2,
			runTask: async (task) => {
				active++;
				maximumActive = Math.max(maximumActive, active);
				await new Promise((resolve) =>
					setTimeout(resolve, delays[Number(task.agent.slice(6))]),
				);
				active--;
				return result(task);
			},
		});

		expect(maximumActive).toBe(2);
		expect(snapshot.entries.map((entry) => entry.task.agent)).toEqual(
			input.map((task) => task.agent),
		);
		expect(
			snapshot.entries.every((entry) => entry.status === "completed"),
		).toBe(true);
	});

	it("publishes queued, running, partial, and settled immutable snapshots", async () => {
		const input = tasks(1);
		const snapshots: Awaited<ReturnType<typeof runParallelRun>>[] = [];
		const final = await runParallelRun({
			tasks: input,
			onUpdate: (snapshot) => snapshots.push(snapshot),
			runTask: (task, onUpdate) => {
				onUpdate(result(task, "partial"));
				return Promise.resolve(result(task, "final"));
			},
		});

		expect(snapshots[0]?.entries[0]?.status).toBe("queued");
		expect(
			snapshots.some((snapshot) => snapshot.entries[0]?.status === "running"),
		).toBe(true);
		expect(
			snapshots.some(
				(snapshot) => snapshot.entries[0]?.result?.model === "partial",
			),
		).toBe(true);
		expect(final.entries[0]?.result?.model).toBe("final");
		expect(Object.isFrozen(final)).toBe(true);
		expect(Object.isFrozen(final.entries)).toBe(true);
		expect(Object.isFrozen(final.entries[0])).toBe(true);
		expect(Object.isFrozen(final.entries[0]?.result)).toBe(true);
	});

	it("turns thrown task errors into failures without stopping other tasks", async () => {
		const input = tasks(2);
		const snapshot = await runParallelRun({
			tasks: input,
			runTask: (task) => {
				if (task.agent === "agent-0") {
					return Promise.reject(new Error("runner exploded"));
				}
				return Promise.resolve(result(task));
			},
		});

		expect(snapshot.entries[0]?.status).toBe("failed");
		expect(snapshot.entries[0]?.result?.errorMessage).toBe("runner exploded");
		expect(snapshot.entries[1]?.status).toBe("completed");
		expect(snapshot.counts).toEqual({
			queued: 0,
			running: 0,
			completed: 1,
			failed: 1,
			cancelled: 0,
		});
	});

	it("cancels queued and running tasks without starting queued work", async () => {
		const input = tasks(3);
		const controller = new AbortController();
		const started: string[] = [];
		const snapshotPromise = runParallelRun({
			tasks: input,
			signal: controller.signal,
			concurrency: 2,
			runTask: (task) => {
				started.push(task.agent);
				return new Promise<SingleResult>((_resolve, reject) => {
					controller.signal.addEventListener(
						"abort",
						() => {
							reject(new Error("aborted"));
						},
						{ once: true },
					);
				});
			},
		});

		await waitFor(() => started.length === 2);
		controller.abort();
		const snapshot = await snapshotPromise;

		expect(started).toEqual(["agent-0", "agent-1"]);
		expect(snapshot.entries.map((entry) => entry.status)).toEqual([
			"cancelled",
			"cancelled",
			"cancelled",
		]);
	});

	it("discards a successful result that settles after cancellation was requested", async () => {
		const input = tasks(1);
		const controller = new AbortController();
		let resolveTask: (() => void) | undefined;
		const snapshotPromise = runParallelRun({
			tasks: input,
			signal: controller.signal,
			runTask: (task) =>
				new Promise<SingleResult>((resolve) => {
					resolveTask = () => {
						resolve(result(task));
					};
				}),
		});

		await waitFor(() => resolveTask !== undefined);
		controller.abort();
		resolveTask?.();
		const snapshot = await snapshotPromise;

		expect(snapshot.entries[0]?.status).toBe("cancelled");
	});

	it("discards a runner failure that settles after cancellation was requested, ignoring the signal entirely", async () => {
		const input = tasks(1);
		const controller = new AbortController();
		let rejectTask: ((error: Error) => void) | undefined;
		const snapshotPromise = runParallelRun({
			tasks: input,
			signal: controller.signal,
			runTask: () =>
				new Promise<SingleResult>((_resolve, reject) => {
					rejectTask = reject;
				}),
		});

		await waitFor(() => rejectTask !== undefined);
		controller.abort();
		rejectTask?.(new Error("runner exploded after cancellation"));
		const snapshot = await snapshotPromise;

		expect(snapshot.entries[0]?.status).toBe("cancelled");
		expect(snapshot.counts).toEqual({
			queued: 0,
			running: 0,
			completed: 0,
			failed: 0,
			cancelled: 1,
		});
	});

	it("keeps a task's terminal status when cancellation is requested after it already settled", async () => {
		const input = tasks(2);
		const controller = new AbortController();
		const snapshots: Awaited<ReturnType<typeof runParallelRun>>[] = [];
		let resolveSecond: (() => void) | undefined;
		const snapshotPromise = runParallelRun({
			tasks: input,
			signal: controller.signal,
			concurrency: 2,
			onUpdate: (snapshot) => {
				snapshots.push(snapshot);
			},
			runTask: (task) => {
				if (task.agent === "agent-0") {
					return Promise.resolve(result(task));
				}
				return new Promise<SingleResult>((resolve) => {
					resolveSecond = () => {
						resolve(result(task));
					};
				});
			},
		});

		await waitFor(
			() => snapshots.some((s) => s.entries[0]?.status === "completed"),
		);
		controller.abort();
		resolveSecond?.();
		const snapshot = await snapshotPromise;

		expect(snapshot.entries[0]?.status).toBe("completed");
		expect(snapshot.entries[1]?.status).toBe("cancelled");
	});

	it("leaves a task running (never force-settling it) when its runner ignores the abort signal entirely", async () => {
		const input = tasks(1);
		const controller = new AbortController();
		let resolveTask: (() => void) | undefined;
		const snapshots: Awaited<ReturnType<typeof runParallelRun>>[] = [];
		const snapshotPromise = runParallelRun({
			tasks: input,
			signal: controller.signal,
			onUpdate: (snapshot) => {
				snapshots.push(snapshot);
			},
			runTask: (task) =>
				new Promise<SingleResult>((resolve) => {
					resolveTask = () => {
						resolve(result(task));
					};
				}),
		});

		await waitFor(() => resolveTask !== undefined);
		controller.abort();

		// The engine offers no engine-level watchdog: an uncooperative runner
		// keeps the task "running" indefinitely, past the point cancellation
		// was requested, until it settles on its own.
		await new Promise((r) => setTimeout(r, 10));
		expect(snapshots[snapshots.length - 1]?.entries[0]?.status).toBe(
			"running",
		);

		resolveTask?.();
		const snapshot = await snapshotPromise;

		expect(snapshot.entries[0]?.status).toBe("cancelled");
	});

	it("ignores a partial update after a task has settled", async () => {
		const input = tasks(1);
		let lateUpdate: ((partial: SingleResult) => void) | undefined;
		const snapshots: Awaited<ReturnType<typeof runParallelRun>>[] = [];
		const final = await runParallelRun({
			tasks: input,
			onUpdate: (snapshot) => snapshots.push(snapshot),
			runTask: (task, onUpdate) => {
				lateUpdate = onUpdate;
				return Promise.resolve(result(task, "final"));
			},
		});
		const snapshotCount = snapshots.length;

		const firstTask = input[0];
		if (!firstTask) {
			throw new Error("Test task was not created");
		}
		if (lateUpdate) {
			lateUpdate(result(firstTask, "late"));
		}

		expect(snapshots).toHaveLength(snapshotCount);
		expect(final.entries[0]?.result?.model).toBe("final");
	});

	it("rejects an oversized collection before scheduling", async () => {
		const oversized = tasks(MAX_PARALLEL_TASKS + 1);
		let called = false;

		await expect(
			runParallelRun({
				tasks: oversized,
				runTask: (task) => {
					called = true;
					return Promise.resolve(result(task));
				},
			}),
		).rejects.toBeInstanceOf(ParallelRunLimitError);
		expect(called).toBe(false);
	});

	it("treats an empty collection as an immediate no-op", async () => {
		const snapshot = await runParallelRun({
			tasks: [],
			runTask: (task) => Promise.resolve(result(task)),
		});

		expect(snapshot.entries).toEqual([]);
		expect(snapshot.counts).toEqual({
			queued: 0,
			running: 0,
			completed: 0,
			failed: 0,
			cancelled: 0,
		});
	});
});
