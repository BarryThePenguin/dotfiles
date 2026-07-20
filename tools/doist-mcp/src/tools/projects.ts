import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container } from "doist-core";
import { listSections, RestApiProjectSchema } from "doist-core";
import {
	EmptyInput,
	ListLabelSchema,
	maybeSyncSummary,
	SectionSchema,
	SectionsListInput,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

const MAX_AUTO_PAGES = 10;

export function registerProjectTools(
	mcp: McpServer,
	container: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_projects_fetch",
		config: {
			description:
				"Fetch a page of projects from the Todoist REST API. For discovering all project IDs, use todoist_projects_discover.",
			inputSchema: toStandardJsonSchema(
				v.optional(
					v.object({
						limit: v.optional(v.number()),
						cursor: v.optional(v.nullable(v.string())),
					}),
				),
			),
			outputSchema: toStandardJsonSchema(
				v.object({
					projects: v.array(RestApiProjectSchema),
					nextCursor: v.optional(v.nullable(v.string())),
				}),
			),
		},
		spanOptions: {},
		callback: async (params) => {
			const { client } = container;
			const limit = params?.limit ?? 200;
			const cursor = params?.cursor ?? null;
			const { projects, nextCursor } = await client.fetchProjects(
				limit,
				cursor,
			);
			return {
				data: { projects, nextCursor },
				text: cursor ? "Available projects (page)" : "Available projects",
				track: {
					"result.count": projects.length,
					paginated: Boolean(cursor),
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_projects_discover",
		config: {
			description:
				"Discover all projects available in your Todoist account (for .doistrc configuration). Fetches all projects by default, or optionally returns paginated results.",
			inputSchema: toStandardJsonSchema(
				v.optional(
					v.object({
						limit: v.optional(v.number()),
						cursor: v.optional(v.nullable(v.string())),
					}),
				),
			),
			outputSchema: toStandardJsonSchema(
				v.object({
					projects: v.array(
						v.object({
							id: v.string(),
							name: v.string(),
							color: v.optional(v.nullable(v.string())),
							is_favorite: v.optional(v.boolean()),
							inbox_project: v.optional(v.boolean()),
							is_archived: v.optional(v.boolean()),
						}),
					),
					nextCursor: v.optional(v.nullable(v.string())),
					truncated: v.optional(v.boolean()),
				}),
			),
		},
		spanOptions: {},
		callback: async (params) => {
			const { client } = container;
			const limit = params?.limit ?? 200;
			const cursor = params?.cursor ?? null;

			if (!cursor) {
				const allProjects = [];
				let nextCursor: string | null = null;
				let pages = 0;
				let truncated = false;

				do {
					const { projects, nextCursor: nc } = await client.fetchProjects(
						limit,
						nextCursor,
					);
					allProjects.push(...projects);
					nextCursor = nc;
					pages++;
					if (pages >= MAX_AUTO_PAGES && nextCursor) {
						truncated = true;
						break;
					}
				} while (nextCursor);

				return {
					data: { projects: allProjects, truncated },
					text: truncated
						? `Available projects (truncated after ${MAX_AUTO_PAGES} pages)`
						: "Available projects",
					track: {
						"result.count": allProjects.length,
						paginated: false,
						"pages.fetched": pages,
						"result.truncated": truncated ? 1 : 0,
					},
				};
			}

			const { projects, nextCursor } = await client.fetchProjects(
				limit,
				cursor,
			);
			return {
				data: { projects, nextCursor },
				text: "Available projects (page)",
				track: {
					"result.count": projects.length,
					paginated: true,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_labels_list",
		config: {
			description: "List all labels from the local database",
			inputSchema: toStandardJsonSchema(EmptyInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
					labels: v.array(ListLabelSchema),
				}),
			),
		},
		spanOptions: {},
		callback: async ({ sync: shouldSync }) => {
			const { db, client, listProjectIds } = container;
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);
			const labels = db.selectAllLabels().map(({ id, name }) => ({ id, name }));
			return {
				data: { sync: syncResult, labels },
				text: "Labels",
				track: {
					"result.count": labels.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_sections_list",
		config: {
			description:
				"List all sections for a given project from the local database",
			inputSchema: toStandardJsonSchema(SectionsListInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
					sections: v.array(SectionSchema),
				}),
			),
		},
		spanOptions: {},
		callback: async ({ project, sync: shouldSync }) => {
			const { db, client, listProjectIds } = container;
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);
			const sections = listSections(db, project);
			return {
				data: { sync: syncResult, sections },
				text: `Sections for project ${project}`,
				track: {
					"result.count": sections.length,
					"filter.project": project ? 1 : 0,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});
}
