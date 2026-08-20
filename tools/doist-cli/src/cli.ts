#!/usr/bin/env node

import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import { defineCommand, runMain } from "citty";
import {
	ATTR_EXITCODE,
	createContainer,
	createTodoistOperations,
	tracer,
} from "doist-core";
import { basename } from "node:path";
import { shutdown } from "./instrumentation.ts";
import { type OperationalContainer, type TodoistOperations } from "doist-core";
import * as analysis from "./commands/analysis.ts";
import * as filters from "./commands/filters.ts";
import * as labels from "./commands/labels.ts";
import * as sync from "./commands/sync.ts";
import * as projects from "./commands/projects.ts";
import * as sections from "./commands/sections.ts";
import * as session from "./commands/session.ts";
import * as tasks from "./commands/tasks.ts";

const container = createContainer();
const operations = createTodoistOperations(container);

const main = defineCommand({
	meta: {
		name: "doist",
		description: "Sync Todoist tasks to SQLite for AI agent consumption",
		version: "0.1.0",
	},
	subCommands: buildCommands(container, operations),
});

const executableName = basename(process.execPath);

try {
	await tracer.startActiveSpan(executableName, async (span) => {
		try {
			await runMain(main);
		} catch (err) {
			span.recordException(err as Error);
			span.setAttribute(
				ATTR_ERROR_TYPE,
				err instanceof Error ? err.name : String(err),
			);
			const message = err instanceof Error ? err.message : String(err);
			process.stderr.write(JSON.stringify({ error: message }) + "\n");
			process.exitCode = 1;
		} finally {
			span.setAttribute(ATTR_EXITCODE, process.exitCode ?? 0);
			span.end();
		}
	});
} finally {
	container.close();
	await shutdown().catch(console.error);
}

function buildCommands(
	container: OperationalContainer,
	operations: TodoistOperations,
) {
	return {
		sync: sync.buildCommand(container),
		projects: projects.buildCommand(container),
		sections: sections.buildCommands(container, operations),
		labels: labels.buildCommands(container),
		filters: filters.buildCommands(container, operations),
		tasks: tasks.buildCommands(container, operations),
		analysis: analysis.buildCommands(container),
		session: session.buildCommands(container),
	};
}
