import {
	TodoistClient,
	type TodoistTask,
	CLAIMED_LABEL,
	parseBlockedBy,
} from "./tracker.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WAYFINDER_PREFIX = "Wayfinder:";
export const STATUS_KEY = "wayfinder";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export const ok = (text: string, details: unknown = {}) => ({
	content: [{ type: "text" as const, text }],
	details,
});

export const err = (msg: string) => ok(`Error: ${msg}`);

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

export function stripPrefix(title: string) {
	return title.startsWith(WAYFINDER_PREFIX + " ")
		? title.slice(WAYFINDER_PREFIX.length + 1)
		: title;
}

export function ticketTypeLabel(type: string) {
	return `wayfinder:${type}`;
}

/** Extract task ID from a Todoist URL or return as-is. */
export function extractId(input: string) {
	const match = input.match(/\/task\/(\d+)/);
	return match ? match[1] : input.trim();
}

// ---------------------------------------------------------------------------
// Todoist helpers
// ---------------------------------------------------------------------------

/** Determine ticket state from labels and description. */
export function ticketState(t: TodoistTask) {
	if (t.labels.includes(CLAIMED_LABEL)) {
		return "claimed";
	}
	if (parseBlockedBy(t.description || "").length > 0) {
		return "blocked";
	}
	return "frontier";
}

/** Format a ticket for display. */
export function formatTicket(t: TodoistTask, opts?: { showState?: boolean }) {
	const type = t.labels.find((l) => l.startsWith("wayfinder:")) ?? "";
	const state = opts?.showState ? ` [${ticketState(t)}]` : "";
	return `${t.id} — ${t.content}${type ? ` (${type})` : ""}${state}`;
}

/**
 * Fetch every ticket that belongs to the given map, identified by parent-child relationship.
 */
export async function getMapTickets(
	client: TodoistClient,
	mapId: string,
	opts?: { completed?: boolean },
): Promise<TodoistTask[]> {
	const all = await client.listTasks();
	const mine = all.filter(
		(t) =>
			t.labels.some((l) => l.startsWith("wayfinder:")) &&
			t.parentId === mapId,
	);
	if (opts?.completed === undefined) {
		return mine;
	}
	return mine.filter((t) => t.isCompleted === opts.completed);
}
