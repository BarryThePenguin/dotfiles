/**
 * Label-set operations.
 *
 * `mergeLabels(current, add, remove)` returns the set difference
 * `(current ∪ add) − remove`, preserving the order of first occurrence
 * (current first, then additions). Remove wins on tie: a label in both
 * `add` and `remove` is dropped. `undefined` for `add` or `remove` is a
 * no-op. The result is always a fresh array.
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
