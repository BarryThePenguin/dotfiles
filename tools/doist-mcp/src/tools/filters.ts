import { McpServer } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import {
	createTodoistOperations,
	FilterQueryInputSchema as FilterQueryInputRaw,
} from "doist-core";
import type { OperationalContainer } from "doist-core";
import {
	FormattedTaskSchema,
	maybeSyncSummary,
	SyncSummarySchema,
} from "./shared.ts";
import { registerTool } from "./traced-tool.ts";

const FilterSchema = v.object({
	id: v.string(),
	name: v.string(),
	query: v.string(),
	color: v.nullable(v.string()),
	itemOrder: v.nullable(v.number()),
	isFavorite: v.boolean(),
});

const FilterListOutputSchema = toStandardJsonSchema(
	v.object({
		sync: v.optional(SyncSummarySchema),
		filters: v.array(FilterSchema),
	}),
);

const FilterAddInputSchema = toStandardJsonSchema(
	v.object({
		name: v.string(),
		query: v.string(),
		color: v.optional(v.nullable(v.string())),
		itemOrder: v.optional(v.number()),
		isFavorite: v.optional(v.boolean()),
		...v.object({ sync: v.optional(v.boolean(), false) }).entries,
	}),
);

const FilterUpdateInputSchema = toStandardJsonSchema(
	v.object({
		id: v.string(),
		name: v.optional(v.string()),
		query: v.optional(v.string()),
		color: v.optional(v.nullable(v.string())),
		itemOrder: v.optional(v.number()),
		isFavorite: v.optional(v.boolean()),
		...v.object({ sync: v.optional(v.boolean(), false) }).entries,
	}),
);

const FilterDeleteInputSchema = toStandardJsonSchema(
	v.object({
		id: v.string(),
		...v.object({ sync: v.optional(v.boolean(), false) }).entries,
	}),
);

const FilterQueryInputSchema = toStandardJsonSchema(FilterQueryInputRaw);

const FilterQueryOutputSchema = toStandardJsonSchema(
	v.object({
		sync: v.optional(SyncSummarySchema),
		tasks: v.array(FormattedTaskSchema),
		hasMore: v.boolean(),
		nextCursor: v.nullable(v.string()),
		appliedFilter: v.string(),
	}),
);

export function registerFilterTools(
	mcp: McpServer,
	container: OperationalContainer,
): void {
	const operations = createTodoistOperations(container);
	registerTool({
		mcp,
		name: "todoist_filters_list",
		config: {
			description: "List all saved filters from the local database",
			inputSchema: toStandardJsonSchema(
				v.object({ sync: v.optional(v.boolean(), false) }),
			),
			outputSchema: FilterListOutputSchema,
			annotations: { readOnlyHint: true },
		},
		spanOptions: {},
		callback: async ({ sync: shouldSync }) => {
			const syncResult = await maybeSyncSummary(container, shouldSync);
			const filters = operations.listFilters();
			return {
				data: { sync: syncResult, filters },
				text: `${filters.length} saved filters`,
				track: {
					"result.count": filters.length,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_filters_add",
		config: {
			description: "Create a new saved filter in Todoist",
			inputSchema: FilterAddInputSchema,
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
					filter: FilterSchema,
				}),
			),
		},
		spanOptions: (args: { name?: string }) => ({
			attributes: { "filter.name": args.name ?? "unknown" },
		}),
		callback: async ({
			name,
			query,
			color,
			itemOrder,
			isFavorite,
			sync: shouldSync,
		}) => {
			const syncResult = await maybeSyncSummary(container, shouldSync);
			const result = await operations.addFilter({
				name,
				query,
				color,
				itemOrder,
				isFavorite,
			});
			if (!result.ok) {
				throw new Error("Failed to add filter");
			}
			return {
				data: { sync: syncResult, filter: result.result },
				text: `Created filter "${result.result.name}"`,
				track: {
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_filters_update",
		config: {
			description: "Update an existing saved filter",
			inputSchema: FilterUpdateInputSchema,
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
					filter: FilterSchema,
				}),
			),
		},
		spanOptions: (args: { id?: string }) => ({
			attributes: { "filter.id": args.id ?? "unknown" },
		}),
		callback: async ({
			id,
			name,
			query,
			color,
			itemOrder,
			isFavorite,
			sync: shouldSync,
		}) => {
			const syncResult = await maybeSyncSummary(container, shouldSync);
			const result = await operations.updateFilter(id, {
				name,
				query,
				color,
				itemOrder,
				isFavorite,
			});
			if (!result.ok) {
				throw new Error("Failed to update filter");
			}
			return {
				data: { sync: syncResult, filter: result.result },
				text: `Updated filter "${result.result.name}"`,
				track: {
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_filters_delete",
		config: {
			description: "Delete a saved filter",
			inputSchema: FilterDeleteInputSchema,
			outputSchema: toStandardJsonSchema(
				v.object({
					sync: v.optional(SyncSummarySchema),
				}),
			),
		},
		spanOptions: (args: { id?: string }) => ({
			attributes: { "filter.id": args.id ?? "unknown" },
		}),
		callback: async ({ id, sync: shouldSync }) => {
			const syncResult = await maybeSyncSummary(container, shouldSync);
			await operations.deleteFilter(id);
			return {
				data: { sync: syncResult },
				text: `Deleted filter ${id}`,
				track: {
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});

	registerTool({
		mcp,
		name: "todoist_filters_query",
		config: {
			description:
				"Run a filter query against Todoist's servers and return matching tasks. Uses Todoist's native filter syntax (e.g. 'today', 'overdue & #Work', 'priority 1 & @work'). This is the recommended way to query tasks — use saved filters from the Todoist UI for consistent results.",
			inputSchema: FilterQueryInputSchema,
			outputSchema: FilterQueryOutputSchema,
			annotations: { readOnlyHint: true },
		},
		spanOptions: (args: { query?: string }) => ({
			attributes: { "filter.query": args.query ?? "unknown" },
		}),
		callback: async ({ query, limit, sync: shouldSync }) => {
			const syncResult = await maybeSyncSummary(container, shouldSync);
			const result = await operations.runFilterQuery(query, limit ?? 50);
			if (!result.ok) {
				throw new Error("Failed to run filter query");
			}
			const enrich = (t: (typeof result.result.tasks)[0]) => ({
				...t,
				projectName: null as string | null,
			});
			return {
				data: {
					sync: syncResult,
					tasks: result.result.tasks.map(enrich),
					hasMore: result.result.hasMore,
					nextCursor: result.result.nextCursor,
					appliedFilter: query,
				},
				text: `${result.result.tasks.length} tasks matching filter: ${query}${result.result.hasMore ? " (more available)" : ""}`,
				track: {
					"result.count": result.result.tasks.length,
					"result.hasMore": result.result.hasMore ? 1 : 0,
					"sync.performed": shouldSync ? 1 : 0,
				},
			};
		},
	});
}
