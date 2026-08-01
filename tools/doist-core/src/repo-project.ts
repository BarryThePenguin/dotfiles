/**
 * Repo-aware project selection over a `.doistrc` list.
 *
 * A Project may carry a `repo: true` marker; this helper selects that
 * project for repo Issues, falling back to the first-listed project when
 * no marker is present. The shared-`.doistrc` side effect (personal-task
 * tooling scanning every listed project) is accepted as-is.
 *
 * `applyRepoMarker` is the write side: it returns the new list with the
 * marker on the given project and removed from every other. The on-disk
 * invariant is "at most one project carries the marker," so the function
 * is exclusive by design. Unchanged projects are returned by reference;
 * only projects whose marker state changes allocate a new object. The
 * `repo` key is omitted (not set to `false`) on unmarked projects so the
 * serialized `.doistrc` matches the load-side schema.
 */

import type { ProjectRef } from "./container.ts";

export function applyRepoMarker(
	projects: readonly ProjectRef[],
	projectId: string,
): ProjectRef[] {
	const next = projects.map((project) => {
		const isRepo = project.repo === true;
		const shouldBeRepo = project.id === projectId;
		if (isRepo === shouldBeRepo) {
			return project;
		}
		if (shouldBeRepo) {
			return { ...project, repo: true };
		}
		const { repo: _drop, ...rest } = project;
		return rest;
	});
	return next.some((project, index) => project !== projects[index])
		? next
		: [...projects];
}

export function selectRepoProject(
	projects: readonly ProjectRef[],
): ProjectRef | undefined {
	if (projects.length === 0) {
		return undefined;
	}
	const marked = projects.find((project) => project.repo === true);
	return marked ?? projects[0];
}
