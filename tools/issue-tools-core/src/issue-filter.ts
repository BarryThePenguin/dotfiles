/**
 * Shared filtering and ordering for the generic Issue list surface.
 *
 * Filters are AND across axes: state, labels (all-of), and unlabeled.
 * `unlabeled: true` is exclusive — the issue carries no labels — and is
 * independent of the `labels` filter (an unlabeled issue never satisfies
 * a labels all-of match).
 *
 * Order: createdAt ascending (oldest first). When `createdAt` is missing
 * (e.g. a local issue whose file has no `Updated:` line), the mtime
 * fallback is the issue's `updatedAt`, then its id as a final tiebreak.
 */

import type { Issue, IssueStatus, ListIssuesFilter } from "./issue.ts";

export function filterIssues(
	issues: readonly Issue[],
	filter: ListIssuesFilter = {},
): Issue[] {
	const state = filter.state ?? "open";
	const labels = filter.labels ?? [];
	const wantUnlabeled = filter.unlabeled ?? false;

	const filtered = issues.filter((issue) => {
		if (state !== "any" && issue.status !== state) {
			return false;
		}
		if (wantUnlabeled) {
			return issue.labels.length === 0;
		}
		if (labels.length > 0) {
			const owned = new Set(issue.labels);
			for (const label of labels) {
				if (!owned.has(label)) {
					return false;
				}
			}
		}
		return true;
	});

	return filtered.toSorted((a, b) => {
		const aTime = createdAtKey(a);
		const bTime = createdAtKey(b);
		if (aTime !== bTime) {
			return aTime.localeCompare(bTime);
		}
		return a.id.localeCompare(b.id, undefined, { numeric: true });
	});
}

function createdAtKey(issue: Issue): string {
	return issue.createdAt ?? issue.updatedAt ?? issue.id;
}

export type { IssueStatus };
