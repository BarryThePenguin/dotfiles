import { defineCommand } from "citty";
import {
	countSyncData,
	type OperationalContainer,
	type SyncResult,
} from "doist-core";
import {
	findDuplicateCandidates,
	findStaleCandidates,
	groupStaleByProject,
} from "doist-core/analysis";
import { findMissingEnergyMetadata } from "doist-personal";
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
			const { queries } = container;
			let sync: SyncResult | undefined;
			if (args.sync) {
				sync = countSyncData(
					await container.sync(container.listProjectIds(), false),
				);
			}

			const allTasks = queries.selectTasks({ kind: "browse" });
			const projects = queries.selectProjects();
			const duplicates = findDuplicateCandidates(allTasks);
			const stale = findStaleCandidates(
				allTasks,
				projects.find((p) => p.isInbox)?.id ?? null,
			);
			const inboxId = projects.find((p) => p.isInbox)?.id ?? null;
			const unroutedInbox = inboxId
				? queries
						.selectTasks({ kind: "browse", projectId: inboxId })
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
				syncedAt: queries.getLastSyncedAt(),
			});
		},
	});
}
