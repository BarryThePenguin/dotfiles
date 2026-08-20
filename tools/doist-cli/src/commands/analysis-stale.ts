import { defineCommand } from "citty";
import {
	countSyncData,
	findStaleCandidates,
	groupStaleByProject,
	type OperationalContainer,
	type SyncResult,
} from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Find stale or abandoned tasks" },
		args: {
			sync: {
				type: "boolean",
				description: "sync before analysis",
			},
		},
		async run({ args }) {
			const { db } = container;
			let sync: SyncResult | undefined;
			if (args.sync) {
				sync = countSyncData(
					await container.sync(container.listProjectIds(), false),
				);
			}
			const projects = db.selectProjects();
			const inboxId = projects.find((p) => p.isInbox)?.id ?? null;
			const analysis = findStaleCandidates(
				db.selectTasks({
					orderBy: { field: "updated_at", direction: "asc" },
				}),
				inboxId,
			);
			const byProject = groupStaleByProject(analysis.candidates, projects);
			out({
				sync,
				...analysis,
				byProject,
				syncedAt: db.getLastSyncedAt(),
			});
		},
	});
}
