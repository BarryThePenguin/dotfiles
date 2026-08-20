/**
 * Parse a comma-separated label list from a CLI arg.
 * Returns `undefined` when the arg is absent or empty, otherwise a trimmed,
 * non-empty array of label names.
 */
export function parseLabelList(
	value: string | undefined,
): string[] | undefined {
	if (!value) {
		return undefined;
	}
	const labels = value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return labels.length > 0 ? labels : undefined;
}
