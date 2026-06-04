import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { Container } from "../container.ts";
import { listSections } from "../operations.ts";
import { RestApiProjectSchema } from "../sdk.ts";
import { trackOperation } from "../telemetry.ts";
import {
	SectionSchema,
	EmptyInput,
	ListLabelSchema,
	maybeSyncSummary,
	requireDb,
	SectionsListInput,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

export function registerProjectTools(
	mcp: McpServer,
	{ db, client, listProjectIds, projectCount, paths }: Container,
): void {
	registerTool({
		mcp,
		name: "todoist_projects_list",
		config: {
			description:
				"Discover projects available in your Todoist account (for .doistrc configuration). Returns the first page or a requested page.",
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
			const limit = params?.limit ?? 200;
			const cursor = params?.cursor ?? null;

			const { projects, nextCursor } = await client.fetchProjects(
				limit,
				cursor,
			);

			trackOperation("todoist_projects_list", true, {
				"result.count": projects.length,
				paginated: Boolean(cursor),
			});
			return {
				content: [
					{
						type: "text",
						text: cursor ? "Available projects (page)" : "Available projects",
					},
				],
				structuredContent: { projects, nextCursor },
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
				}),
			),
		},
		spanOptions: {},
		callback: async (params) => {
			const limit = params?.limit ?? 200;
			const cursor = params?.cursor ?? null;

			if (!cursor) {
				const allProjects = [];
				let nextCursor: string | null = null;

				do {
					const { projects, nextCursor: nc } = await client.fetchProjects(
						limit,
						nextCursor,
					);
					allProjects.push(...projects);
					nextCursor = nc;
				} while (nextCursor);

				trackOperation("todoist_projects_discover", true, {
					"result.count": allProjects.length,
					paginated: false,
				});
				return {
					content: [{ type: "text", text: "Available projects" }],
					structuredContent: { projects: allProjects },
				};
			}

			const { projects, nextCursor } = await client.fetchProjects(
				limit,
				cursor,
			);

			trackOperation("todoist_projects_discover", true, {
				"result.count": projects.length,
				paginated: true,
			});
			return {
				content: [{ type: "text", text: "Available projects (page)" }],
				structuredContent: { projects, nextCursor },
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
			requireDb(db);
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);

			const labels = db.selectAllLabels().map(({ id, name }) => ({ id, name }));
			trackOperation("todoist_labels_list", true, {
				"result.count": labels.length,
				"sync.performed": shouldSync ? 1 : 0,
			});
			return {
				content: [{ type: "text", text: "Labels" }],
				structuredContent: { sync: syncResult, labels },
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
			requireDb(db);
			const syncResult = await maybeSyncSummary(
				db,
				client,
				listProjectIds,
				shouldSync,
			);

			const sections = listSections(db, project);
			trackOperation("todoist_sections_list", true, {
				"result.count": sections.length,
				"filter.project": project ? 1 : 0,
				"sync.performed": shouldSync ? 1 : 0,
			});
			return {
				content: [{ type: "text", text: `Sections for project ${project}` }],
				structuredContent: { sync: syncResult, sections },
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_config",
		config: {
			description: "Show the active server configuration",
			inputSchema: toStandardJsonSchema(EmptyInput),
			outputSchema: toStandardJsonSchema(
				v.object({
					rcPath: v.optional(v.string()),
					dbPath: v.optional(v.string()),
					projects: v.array(v.string()),
				}),
			),
		},
		spanOptions: {},
		callback: () => {
			trackOperation("todoist_config", true, {
				"config.projects": projectCount(),
			});
			return {
				content: [{ type: "text", text: "Active configuration" }],
				structuredContent: {
					...paths,
					projects: listProjectIds(),
				},
			};
		},
	});
}
