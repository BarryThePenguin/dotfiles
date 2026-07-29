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
