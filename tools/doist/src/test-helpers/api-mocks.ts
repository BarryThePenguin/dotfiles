/**
 * Mock API response builders and interceptors for Todoist API testing.
 */

import * as undici from "undici";

export const TODOIST_ORIGIN = "https://api.todoist.com";

// ── API Response Builders ────────────────────────────────────────────────

/**
 * Create a mock Todoist API task response.
 *
 * @param overrides - Property overrides for the base task
 * @returns Task object matching Todoist API format
 */
export function createMockApiTask(overrides: Record<string, unknown> = {}) {
	return {
		id: "t1",
		project_id: "p1",
		section_id: null,
		content: "Write tests",
		description: "All the tests",
		priority: 1,
		due: null,
		labels: [] as string[],
		checked: false,
		added_at: null,
		is_deleted: false,
		...overrides,
	};
}

/**
 * Create a mock Todoist API project response.
 *
 * @param overrides - Property overrides for the base project
 * @returns Project object matching Todoist API format
 */
export function createMockApiProject(overrides: Record<string, unknown> = {}) {
	return {
		id: "p1",
		name: "Work",
		color: null,
		favorite: false,
		is_deleted: false,
		is_archived: false,
		...overrides,
	};
}

/**
 * Create a mock Todoist API section response.
 *
 * @param overrides - Property overrides for the base section
 * @returns Section object matching Todoist API format
 */
export function createMockApiSection(overrides: Record<string, unknown> = {}) {
	return {
		id: "s1",
		project_id: "p1",
		name: "Backlog",
		order: 1,
		is_deleted: false,
		...overrides,
	};
}

/**
 * Create a mock Todoist API label response.
 *
 * @param overrides - Property overrides for the base label
 * @returns Label object matching Todoist API format
 */
export function createMockApiLabel(overrides: Record<string, unknown> = {}) {
	return {
		id: "l1",
		name: "urgent",
		color: "red",
		is_deleted: false,
		...overrides,
	};
}

// ── Sync Response Builders ────────────────────────────────────────────────

/**
 * Create a mock sync response body.
 *
 * @param overrides - Override specific sections of the sync response
 * @returns Sync response matching Todoist API format
 */
export function createMockSyncResponse(
	overrides: {
		sync_token?: string;
		projects?: unknown[];
		sections?: unknown[];
		labels?: unknown[];
		items?: unknown[];
		temp_id_mapping?: Record<string, unknown>;
		sync_status?: Record<string, unknown>;
	} = {},
) {
	return {
		sync_token: "tok-1",
		full_sync: false,
		projects: [],
		sections: [],
		labels: [],
		items: [],
		temp_id_mapping: {},
		sync_status: {},
		...overrides,
	};
}

// ── Interceptors ────────────────────────────────────────────────────────

/**
 * Intercept a POST /api/v1/sync request with a static response.
 *
 * @param mockAgent - The MockAgent instance
 * @param body - Response body to return
 */
export function interceptSync(mockAgent: undici.MockAgent, body: unknown) {
	mockAgent
		.get(TODOIST_ORIGIN)
		.intercept({ path: "/api/v1/sync", method: "POST" })
		.reply(200, JSON.stringify(body), {
			headers: { "content-type": "application/json" },
		});
}

/**
 * Intercept a POST /api/v1/sync request with a dynamic response handler.
 * Useful for extracting command details from the request body.
 *
 * @param mockAgent - The MockAgent instance
 * @param handler - Handler that receives request body and returns response
 */
export function interceptSyncDynamic(
	mockAgent: undici.MockAgent,
	handler: (body: string) => Record<string, unknown>,
) {
	mockAgent
		.get(TODOIST_ORIGIN)
		.intercept({ path: "/api/v1/sync", method: "POST" })
		.reply(({ body: reqBody }) => {
			const responseData = handler(reqBody as string);
			return {
				statusCode: 200,
				data: JSON.stringify(responseData),
				headers: { "content-type": "application/json" },
			};
		});
}

/**
 * Intercept a POST /api/v1/sync request to simulate an error response.
 *
 * @param mockAgent - The MockAgent instance
 * @param statusCode - HTTP status code (default: 500)
 * @param errorMessage - Error message to return
 */
export function interceptSyncError(
	mockAgent: undici.MockAgent,
	statusCode: number = 500,
	errorMessage: string = "Internal Server Error",
) {
	mockAgent
		.get(TODOIST_ORIGIN)
		.intercept({ path: "/api/v1/sync", method: "POST" })
		.reply(statusCode, JSON.stringify({ error: errorMessage }), {
			headers: { "content-type": "application/json" },
		});
}
