import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultHarness, makeClient } from "../test-helpers/server.ts";
import { buildServer } from "../server.ts";
import { createTestContainer } from "../test-helpers/container.ts";

let harness: Awaited<ReturnType<typeof createDefaultHarness>>;

beforeEach(async () => {
	harness = await createDefaultHarness();
});

afterEach(async () => {
	await harness.client.close();
	harness.container.close();
});

describe("projects_list", () => {
	it("returns the first page", async () => {
		const result = (await harness.client.callTool("todoist_projects_list")) as {
			projects: Array<{ id: string; name: string }>;
			nextCursor: string | null;
		};
		expect(result.projects).toHaveLength(2);
		expect(result.projects[0]).toMatchObject({ id: "p1", name: "Work" });
		expect(result.nextCursor).toBeNull();
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
		const result = (await harness.client.callTool("todoist_projects_list", {
			cursor: "abc",
		})) as { projects: Array<{ id: string }>; nextCursor: string | null };
		expect(result.projects).toHaveLength(1);
		expect(result.nextCursor).toBe("next");
	});
});

describe("projects_discover", () => {
	it("returns all projects", async () => {
		const result = (await harness.client.callTool(
			"todoist_projects_discover",
		)) as {
			projects: Array<{ id: string; name: string }>;
		};
		expect(result.projects).toHaveLength(2);
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
		const result = (await harness.client.callTool("todoist_projects_discover", {
			cursor: "abc",
		})) as { projects: Array<{ id: string }>; nextCursor: string | null };
		expect(result.projects).toHaveLength(1);
		expect(result.nextCursor).toBe("next");
	});
});

describe("labels_list", () => {
	it("returns all labels", async () => {
		const result = (await harness.client.callTool("todoist_labels_list")) as {
			labels: Array<{ id: string; name: string }>;
		};
		expect(result.labels).toEqual([{ id: "l1", name: "urgent" }]);
	});
});

describe("sections_list", () => {
	it("returns all sections", async () => {
		const result = (await harness.client.callTool("todoist_sections_list")) as {
			sections: Array<{ id: string; name: string }>;
		};
		expect(result.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "s1", name: "Backlog" }),
			]),
		);
	});

	it("filters by project", async () => {
		const result = (await harness.client.callTool("todoist_sections_list", {
			project: "p1",
		})) as { sections: Array<{ id: string }> };
		expect(result.sections).toHaveLength(1);
	});

	it("returns empty for unknown project", async () => {
		const result = (await harness.client.callTool("todoist_sections_list", {
			project: "unknown",
		})) as { sections: Array<unknown> };
		expect(result.sections).toHaveLength(0);
	});

	it("filters by project name as well as id", async () => {
		const result = (await harness.client.callTool("todoist_sections_list", {
			project: "Work",
		})) as { sections: Array<unknown> };
		expect(result.sections).toHaveLength(1);
	});
});

describe("config", () => {
	it("returns config when no db is present", async () => {
		const container = createTestContainer();
		vi.spyOn(container, "db", "get").mockThrow(new Error("No database"));

		const server = buildServer(container);
		const client = await makeClient(server);
		try {
			await expect(client.callTool("todoist_config", {})).resolves.toEqual({
				cwd: expect.any(String) as unknown,
				dbPath: expect.any(String) as unknown,
				projects: [],
				rcPath: expect.any(String) as unknown,
			});
		} finally {
			await client.close();
		}
	});
});
