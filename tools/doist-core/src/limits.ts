/**
 * Todoist per-field character limits, enforced on user input.
 *
 * Single source of truth for every bound used by the valibot input schemas in
 * `schemas.ts`. Each entry corresponds to a column limit in Todoist's REST/Sync
 * API. The MCP server and CLI both route user input through the parsers built
 * from these constants.
 *
 * `projectName` and `sectionName` are documented here for completeness, but
 * this codebase does not currently expose project or section creation tools,
 * so the corresponding limits are not enforced on input. They are kept in the
 * map so a future creation tool can wire them up without re-discovering the
 * numbers.
 */
export const LIMITS = {
	taskName: 500,
	taskDescription: 16383,
	date: 150,
	sectionName: 2048,
	projectName: 120,
	filterName: 60,
	filterQuery: 1024,
	labelName: 60,
	taskComment: 15000,
} as const;
