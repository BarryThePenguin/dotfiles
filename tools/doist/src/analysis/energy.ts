import type { AppTask } from "../schema.ts";

const ENERGY_LABELS = new Set([
	"low-energy",
	"medium-energy",
	"high-energy",
	"quick",
]);
const LOW_ELIGIBLE = new Set(["low-energy", "quick"]);
const MEDIUM_ELIGIBLE = new Set(["low-energy", "medium-energy", "quick"]);

export function findMissingEnergyMetadata(tasks: AppTask[]): AppTask[] {
	return tasks.filter(
		(t) =>
			(t.priority === null || t.priority === 4) &&
			!t.labels.some((l) => ENERGY_LABELS.has(l)),
	);
}

export function filterByEnergy(
	tasks: AppTask[],
	energy: "low" | "medium" | "high",
): AppTask[] {
	if (energy === "high") {
		return [];
	}

	const eligible = energy === "low" ? LOW_ELIGIBLE : MEDIUM_ELIGIBLE;
	const matched = tasks.filter((t) => t.labels.some((l) => eligible.has(l)));

	if (matched.length > 0) {
		return matched.slice(0, 2);
	}

	return tasks
		.slice()
		.sort((a, b) => (a.priority ?? 4) - (b.priority ?? 4))
		.slice(0, 2);
}
