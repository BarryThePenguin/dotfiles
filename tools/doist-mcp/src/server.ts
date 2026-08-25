import { McpServer } from "@modelcontextprotocol/server";
import {
	createTodoistOperations,
	toOperationalContainer,
	type RootContainer,
} from "doist-core";
import { registerPrompts } from "./prompts.ts";
import { registerAnalysisTools } from "./tools/analysis.ts";
import { registerFilterTools } from "./tools/filters.ts";
import { registerProjectTools } from "./tools/projects.ts";
import { registerResources } from "./tools/resources.ts";
import { registerSessionTools } from "./tools/session.ts";
import { registerSyncTools } from "./tools/sync.ts";
import { registerTaskTools } from "./tools/tasks.ts";

export function buildServer(root: RootContainer): McpServer {
	const mcp = new McpServer({ name: "doist", version: "0.1.0" });
	const operations = createTodoistOperations(root);
	const container = toOperationalContainer(root);

	registerAnalysisTools(mcp, container);
	registerFilterTools(mcp, container, operations);
	registerProjectTools(mcp, container, operations);
	registerPrompts(mcp, container);
	registerResources(mcp, container);
	registerSessionTools(mcp, container);
	registerSyncTools(mcp, container);
	registerTaskTools(mcp, container, operations);

	return mcp;
}
