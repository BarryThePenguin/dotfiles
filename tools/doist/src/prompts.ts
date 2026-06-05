import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container } from "./container.ts";
import { logger } from "./logger.ts";
import { resolveProject } from "./operations.ts";

export function registerPrompts(mcp: McpServer, container: Container): void {
	mcp.registerPrompt(
		"todoist_next_task",
		{
			title: "Which task should I focus on next?",
			description:
				"Get a recommendation on the next task to work on based on priorities, blockers, and due dates",
			argsSchema: toStandardJsonSchema(
				v.object({
					project: v.pipe(
						v.optional(v.string()),
						v.description(
							"Project name to analyze. If omitted, analyzes all tasks.",
						),
					),
				}),
			),
		},
		({ project: projectName }) => {
			try {
				const { db } = container;
				const projectId = projectName
					? resolveProject(db, projectName)
					: undefined;
				const tasks =
					projectName && !projectId ? [] : db.selectTasks({ projectId });

				if (tasks.length === 0) {
					return {
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: `I have no tasks in ${projectName || "any project"}. What should I work on?`,
								},
							},
						],
					};
				}

				const taskList = tasks
					.map((task) => {
						const labels = task.labels.length
							? ` [${task.labels.join(", ")}]`
							: "";
						const dueDate = task.due?.date ? ` (due: ${task.due.date})` : "";
						const priority = task.priority ? ` (p${task.priority})` : "";
						return `- ${task.content}${labels}${dueDate}${priority} (${task.id})`;
					})
					.join("\n");

				const prompt = projectName
					? `I'm working on "${projectName}". Here are my tasks:\n\n${taskList}\n\nWhich task should I focus on next?`
					: `Here are all my tasks:\n\n${taskList}\n\nWhich task should I focus on next?`;

				return {
					messages: [
						{
							role: "user",
							content: {
								type: "text",
								text: prompt,
							},
						},
					],
				};
			} catch (err) {
				logger.error(
					{
						error: err instanceof Error ? err.message : String(err),
						project: projectName,
					},
					"Failed to generate task recommendation prompt",
				);
				throw err;
			}
		},
	);

	mcp.registerPrompt(
		"todoist_cleanup_session",
		{
			title: "Todoist cleanup session",
			description:
				"Step-by-step triage flow for sync, inbox cleanup, duplicate review, and stale task cleanup",
			argsSchema: toStandardJsonSchema(
				v.object({
					project: v.pipe(
						v.optional(v.string()),
						v.description(
							"Optional project name to focus the cleanup session.",
						),
					),
				}),
			),
		},
		({ project: projectName }) => {
			const scope = projectName ? ` for "${projectName}"` : "";
			return {
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: [
								`Let's run a Todoist cleanup session${scope}.`,
								"Work one step at a time:",
								"1. Sync the local database if needed.",
								"2. Inspect the inbox and active tasks.",
								"3. Find duplicate candidates using todoist_find_duplicates.",
								"4. Find stale candidates using todoist_find_stale_tasks.",
								"5. Ask for one decision at a time and stop after any phase if needed.",
							].join("\n"),
						},
					},
				],
			};
		},
	);
}
