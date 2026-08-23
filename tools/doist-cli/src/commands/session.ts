import { defineCommand } from "citty";
import {
	countSyncData,
	TRIAGE_THRESHOLD,
	type OperationalContainer,
	type SyncResult,
} from "doist-core";
import { filterByEnergy } from "doist-personal";
import { out } from "../output.ts";

export function buildCommands(container: OperationalContainer) {
	return defineCommand({
		meta: { description: "Session check-in summaries" },
		subCommands: {
			summary: defineCommand({
				meta: {
					description:
						"Overdue, today, thoughts count, and energy-matched suggestions",
				},
				args: {
					energy: {
						type: "string",
						description: "energy level (low, medium, high)",
					},
					sync: {
						type: "boolean",
						description: "sync before summary",
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

					const overdue = db.selectTasks({ due: "overdue" });
					const today = db.selectTasks({ due: "today" });
					const thoughts = db.selectTasks({ label: "thoughts" });
					const requiresTriage = overdue.length > TRIAGE_THRESHOLD;
					const suggested =
						args.energy && ["low", "medium", "high"].includes(args.energy)
							? filterByEnergy(
									db.selectTasks(),
									args.energy as "low" | "medium" | "high",
								)
							: [];

					out({
						sync,
						overdue,
						today,
						thoughtsCount: thoughts.length,
						requiresTriage,
						suggested,
						syncedAt: db.getLastSyncedAt(),
					});
				},
			}),
		},
	});
}
