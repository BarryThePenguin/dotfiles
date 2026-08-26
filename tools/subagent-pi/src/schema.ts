import { Type } from "typebox";

const TaskItem = Type.Object({
	agent: Type.String({
		description:
			"Name of the agent to invoke (general, explore; aliases general-purpose, Explore)",
	}),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(
		Type.String({ description: "Working directory for the agent process" }),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description:
				"Per-task watchdog timeout in ms (parallel mode only); overrides taskTimeoutMs and the default (10 minutes)",
		}),
	),
});

export const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({
			description: "Name of the agent to invoke (for single mode)",
		}),
	),
	task: Type.Optional(
		Type.String({ description: "Task to delegate (for single mode)" }),
	),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description: "Array of {agent, task} for parallel execution",
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description: "Working directory for the agent process (single mode)",
		}),
	),
	taskTimeoutMs: Type.Optional(
		Type.Number({
			description:
				"Default per-task watchdog timeout in ms for parallel mode (default 10 minutes); a stalled task is killed and reported as failed so the rest of the batch can settle. Individual tasks may override via their own timeoutMs.",
		}),
	),
});
