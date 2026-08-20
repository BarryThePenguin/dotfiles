import type { TicketType } from "./schema.ts";

export const WAYFINDER_MAP_LABEL = "wayfinder_map";

export const TODOIST_TICKET_TYPE_LABELS = {
	research: "wayfinder_research",
	prototype: "wayfinder_prototype",
	grilling: "wayfinder_grilling",
	task: "wayfinder_task",
} as const satisfies Record<TicketType, string>;

export type TodoistWayfinderTicketLabel =
	(typeof TODOIST_TICKET_TYPE_LABELS)[TicketType];

export function ticketTypeToTodoistLabel(type: TicketType): string {
	return TODOIST_TICKET_TYPE_LABELS[type];
}

export function todoistLabelToTicketType(
	label: string,
): TicketType | undefined {
	for (const [type, todoistLabel] of Object.entries(
		TODOIST_TICKET_TYPE_LABELS,
	)) {
		if (label === todoistLabel) {
			return type as TicketType;
		}
	}
	return undefined;
}

/**
 * Returns `(current ∪ add) − remove`, preserving first-occurrence order.
 * Remove wins on tie. `undefined` for add/remove is a no-op.
 */
export function mergeLabels(
	current: readonly string[],
	add: readonly string[] | undefined,
	remove: readonly string[] | undefined,
): string[] {
	const removeSet = new Set(remove);
	const seen = new Set<string>();
	const result: string[] = [];
	for (const label of [...current, ...(add ?? [])]) {
		if (removeSet.has(label) || seen.has(label)) {
			continue;
		}
		seen.add(label);
		result.push(label);
	}
	return result;
}
