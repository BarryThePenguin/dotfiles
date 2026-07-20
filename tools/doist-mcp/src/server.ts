import { McpServer } from "@modelcontextprotocol/server";
import type { Container } from "doist-core";
import { registerPrompts } from "./prompts.ts";
import { registerAnalysisTools } from "./tools/analysis.ts";
import { registerProjectTools } from "./tools/projects.ts";
import { registerResources } from "./tools/resources.ts";
import { registerSessionTools } from "./tools/session.ts";
import { registerSyncTools } from "./tools/sync.ts";
import { registerTaskTools } from "./tools/tasks.ts";

export function buildServer(container: Container): McpServer {
	const mcp = new McpServer({ name: "doist", version: "0.1.0" });

	registerAnalysisTools(mcp, container);
	registerProjectTools(mcp, container);
	registerPrompts(mcp, container);
	registerResources(mcp, container);
	registerSessionTools(mcp, container);
	registerSyncTools(mcp, container);
	registerTaskTools(mcp, container);

	return mcp;
}
