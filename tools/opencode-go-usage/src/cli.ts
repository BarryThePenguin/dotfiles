#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { OpenCodeGoUsageClient, RoutingMetrics } from "./index.ts";
import { asJson, formatUsage, isStrictFailure } from "./output.ts";

const main = defineCommand({
	meta: {
		name: "go-usage",
		description: "Show OpenCode Go quota usage and reset times",
		version: "0.1.0",
	},
	args: {
		json: {
			type: "boolean",
			description: "write machine-readable JSON",
		},
		strict: {
			type: "boolean",
			description: "fail when usage is unavailable, stale, or has a warning",
		},
		endpoint: {
			type: "string",
			description: "override the usage API endpoint",
		},
		report: {
			type: "boolean",
			description: "show local routing metrics instead of quota usage",
		},
	},
	async run({ args }) {
		if (args.report) {
			const summary = new RoutingMetrics().summary();
			process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
			return;
		}

		const result = await new OpenCodeGoUsageClient({
			...(args.endpoint ? { endpoint: args.endpoint } : {}),
		}).get();

		process.stdout.write(
			(args.json ? JSON.stringify(asJson(result)) : formatUsage(result)) + "\n",
		);

		if (args.strict && isStrictFailure(result)) {
			process.exitCode = 1;
		}
		if (!result.usage && !args.strict) {
			process.exitCode = 1;
		}
	},
});

await runMain(main);
