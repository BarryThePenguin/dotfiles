import { defineCommand } from "citty";
import {
	countSyncData,
	findDuplicateCandidates,
	findMissingEnergyMetadata,
	findStaleCandidates,
	groupStaleByProject,
	type OperationalContainer,
	type SyncResult,
} from "doist-core";
import { out } from "../output.ts";

export function buildCommand(container: OperationalContainer) {
	return defineCommand({
		meta: {
			description:
				"Aggregate triage: duplicates, stale tasks, unrouted inbox, missing energy metadata",
		},
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

			const allTasks = db.selectTasks();
			const projects = db.selectProjects();
			const duplicates = findDuplicateCandidates(allTasks);
			const stale = findStaleCandidates(
				allTasks,
				projects.find((p) => p.isInbox)?.id ?? null,
			);
			const inboxId = projects.find((p) => p.isInbox)?.id ?? null;
			const unroutedInbox = inboxId
				? db
						.selectTasks({ projectId: inboxId })
						.filter((t) => !t.labels.includes("thoughts"))
				: [];
			const missingEnergy = findMissingEnergyMetadata(allTasks);
			const requiresAttention =
				duplicates.groups.length > 0 ||
				stale.candidates.length > 0 ||
				unroutedInbox.length > 0 ||
				missingEnergy.length > 0;

			out({
				sync,
				duplicates: {
					groups: duplicates.groups.length,
					exactGroups: duplicates.exactGroups,
					fuzzyGroups: duplicates.fuzzyGroups,
					candidates: duplicates.candidates,
				},
				stale: {
					candidates: stale.candidates.length,
					byProject: groupStaleByProject(stale.candidates, projects),
				},
				unroutedInbox: unroutedInbox.length,
				missingEnergyMetadata: missingEnergy.length,
				requiresAttention,
				syncedAt: db.getLastSyncedAt(),
			});
		},
	});
}
