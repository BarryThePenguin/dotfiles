import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { cwd } from "node:process";
import type { Container } from "doist-core";

export function registerResources(mcp: McpServer, container: Container): void {
	mcp.registerResource(
		"todoist_config",
		"todoist://config",
		{
			description:
				"Active server configuration: working directory, database path, and tracked project IDs",
			mimeType: "application/json",
		},
		(uri) => {
			const { paths, listProjectIds } = container;
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(
							{ cwd: cwd(), ...paths, projects: listProjectIds() },
							null,
							2,
						),
					},
				],
			};
		},
	);

	mcp.registerResource(
		"todoist_projects",
		"todoist://projects",
		{
			description: "All projects tracked in the local database",
			mimeType: "application/json",
		},
		(uri) => {
			const { db } = container;
			const projects = db.selectProjects();
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(projects, null, 2),
					},
				],
			};
		},
	);

	mcp.registerResource(
		"todoist_labels",
		"todoist://labels",
		{
			description: "All labels in the local database",
			mimeType: "application/json",
		},
		(uri) => {
			const { db } = container;
			const labels = db.selectAllLabels().map(({ id, name }) => ({ id, name }));
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(labels, null, 2),
					},
				],
			};
		},
	);

	mcp.registerResource(
		"todoist_task",
		new ResourceTemplate("todoist://tasks/{id}", { list: undefined }),
		{
			description: "A single Todoist task by ID",
			mimeType: "application/json",
		},
		(uri, variables) => {
			const { db } = container;
			const id = String(variables["id"]);
			const task = db.getTaskById(id);
			if (!task) {
				throw new Error(`task not found: ${id}`);
			}
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(task, null, 2),
					},
				],
			};
		},
	);
}
