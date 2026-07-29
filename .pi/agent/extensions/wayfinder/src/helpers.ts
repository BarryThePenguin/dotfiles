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

/** Extract a tracker task ID from a known URL shape or return as-is. */
export function extractId(input: string) {
	const match = input.match(/\/task\/(\d+)/);
	return match ? match[1] : input.trim();
}
