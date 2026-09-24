import { spawn, type ChildProcess } from "node:child_process";
import { Effect, Result, Stream } from "effect";
import { Plugin } from "@opencode/plugin/effect";

class Caffeinate {
	#proc: ChildProcess | null = null;

	start() {
		if (this.#proc) {
			return;
		}

		this.#proc = spawn("caffeinate", ["-i"], {
			stdio: "ignore",
		});
		this.#proc.on("error", (error) => {
			log("failed to start caffeinate:", error.message);
			this.#proc = null;
		});
		log("preventing system sleep");
	}

	stop() {
		if (!this.#proc) {
			return;
		}
		this.#proc.kill();
		this.#proc = null;
		log("allowing system sleep");
	}
}

// OpenCode instantiates the plugin once per location, all sharing this server
// process. Keep the caffeinate process and busy-session set at module scope so
// every instance cooperates on a single `caffeinate` process.
const busySessions = new Set<string>();
const caffeinate = new Caffeinate();

function log(...args: unknown[]) {
	console.error(`[caffeinate]`, ...args);
}

function setStatus(status: "idle" | "busy", sessionID: string) {
	if (status === "busy") {
		const wasEmpty = busySessions.size === 0;
		busySessions.add(sessionID);
		if (wasEmpty) {
			caffeinate.start();
		}
	} else {
		busySessions.delete(sessionID);
		if (busySessions.size === 0) {
			caffeinate.stop();
		}
	}
}

const plugin: Plugin.Plugin = Plugin.define({
	id: "caffeinate",
	effect: (ctx) =>
		Effect.gen(function* () {
			// macOS only — caffeinate does not exist elsewhere.
			if (process.platform !== "darwin") {
				return;
			}

			// Sync cleanup on process exit — finalizers won't run there.
			// acquireRelease pairs the listener registration with its removal.
			yield* Effect.acquireRelease(
				Effect.sync(() => {
					const handler = () => {
						caffeinate.stop();
					};
					process.on("exit", handler);
					return handler;
				}),
				(handler) =>
					Effect.sync(() => {
						process.off("exit", handler);
					}),
			);

			yield* ctx.event.subscribe().pipe(
				// Classify each event: `Result.succeed` passes the busy/idle
				// intent downstream, `Result.fail` drops the event.
				Stream.filterMap((event) => {
					let status: "busy" | "idle" | undefined;
					let sessionID: string | undefined;

					if (
						event.type === "session.execution.started" ||
						(event.type === "session.status" &&
							event.data.status.type === "busy")
					) {
						status = "busy";
						sessionID = event.data.sessionID;
					}
					if (
						event.type === "session.execution.succeeded" ||
						event.type === "session.execution.failed" ||
						event.type === "session.idle"
					) {
						status = "idle";
						sessionID = event.data.sessionID;
					}

					if (status && sessionID) {
						return Result.succeed({ status, sessionID });
					}

					return Result.fail(undefined);
				}),
				Stream.runForEach((intent) =>
					Effect.sync(() => {
						setStatus(intent.status, intent.sessionID);
					}),
				),
				Effect.forkScoped,
			);

			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					caffeinate.stop();
				}),
			);
		}),
});

export default plugin;
