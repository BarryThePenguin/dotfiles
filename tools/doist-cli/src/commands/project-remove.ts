import { defineCommand } from "citty";
import type { OperationalContainer } from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Remove a project from the sync allowlist by id" },
		args: {
			id: { type: "positional", description: "project id", required: true },
		},
		run({ args }) {
			container.removeProject(args.id);
			out({ ok: true, removed: args.id });
		},
	});
}
