import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultHarness } from "../test-helpers/server.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

describe("projects_fetch", () => {
	it("returns the first page", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_projects_fetch",
		});
		expect(structuredContent).toHaveProperty("projects", [
			expect.objectContaining({ id: "p1", name: "Work" }),
			expect.objectContaining({ id: "p2", name: "Personal" }),
		]);
		expect(structuredContent).toHaveProperty("nextCursor", null);
	});

	it("returns paginated results when cursor is provided", async () => {
		harness.container.client.fetchProjects.mockResolvedValueOnce({
			projects: [
				{
					id: "p2",
					name: "Side",
					color: null,
					is_favorite: false,
					inbox_project: false,
					is_deleted: false,
					is_archived: false,
				},
			],
			nextCursor: "next",
		});
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_projects_fetch",
			arguments: {
				cursor: "abc",
			},
		});
		expect(structuredContent).toHaveProperty(
			"projects",
			expect.objectContaining({ length: 1 }),
		);
		expect(structuredContent).toHaveProperty("nextCursor", "next");
	});
});

describe("projects_discover", () => {
	it("returns all projects", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_projects_discover",
		});
		expect(structuredContent).toHaveProperty(
			"projects",
			expect.objectContaining({ length: 2 }),
		);
	});

	it("returns paginated results when cursor is provided", async () => {
		harness.container.client.fetchProjects.mockResolvedValueOnce({
			projects: [
				{
					id: "p2",
					name: "Side",
					color: null,
					is_favorite: false,
					inbox_project: false,
					is_deleted: false,
					is_archived: false,
				},
			],
			nextCursor: "next",
		});
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_projects_discover",
			arguments: {
				cursor: "abc",
			},
		});
		expect(structuredContent).toHaveProperty(
			"projects",
			expect.objectContaining({ length: 1 }),
		);
		expect(structuredContent).toHaveProperty("nextCursor", "next");
	});
});

describe("labels_list", () => {
	it("returns all labels", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_labels_list",
		});
		expect(structuredContent).toHaveProperty("labels", [
			{ id: "l1", name: "urgent" },
		]);
	});
});

describe("sections_list", () => {
	it("returns all sections", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_sections_list",
		});
		expect(structuredContent).toHaveProperty(
			"sections",
			expect.arrayContaining([
				expect.objectContaining({ id: "s1", name: "Backlog" }),
			]),
		);
	});

	it("filters by project", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_sections_list",
			arguments: {
				project: "p1",
			},
		});
		expect(structuredContent).toHaveProperty(
			"sections",
			expect.objectContaining({ length: 1 }),
		);
	});

	it("returns empty for unknown project", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_sections_list",
			arguments: {
				project: "unknown",
			},
		});
		expect(structuredContent).toHaveProperty("sections", []);
	});

	it("filters by project name as well as id", async () => {
		const { structuredContent } = await harness.client.callTool({
			name: "todoist_sections_list",
			arguments: {
				project: "Work",
			},
		});
		expect(structuredContent).toHaveProperty(
			"sections",
			expect.objectContaining({ length: 1 }),
		);
	});
});
