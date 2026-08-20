import type { OperationalContainer } from "doist-core";
import { defineCommand } from "citty";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Add a project to the sync allowlist" },
		args: {
			id: { type: "positional", description: "project id", required: true },
			label: {
				type: "positional",
				description: "project label",
				required: true,
			},
		},
		run({ args }) {
			container.addProject({ id: args.id, label: args.label });
			out({ ok: true, added: { id: args.id, label: args.label } });
		},
	});
}
