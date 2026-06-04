import { McpServer } from "@modelcontextprotocol/server";
import type { Container } from "./container.ts";
import { registerPrompts } from "./prompts.ts";
import { registerAnalysisTools } from "./tools/analysis.ts";
import { registerProjectTools } from "./tools/projects.ts";
import { registerReviewTool } from "./tools/review.ts";
import { registerSyncTools } from "./tools/sync.ts";
import { registerTaskTools } from "./tools/tasks.ts";

export function buildServer(container: Container): McpServer {
	const mcp = new McpServer({ name: "doist", version: "0.1.0" });

	registerAnalysisTools(mcp, container);
	registerProjectTools(mcp, container);
	registerPrompts(mcp, container);
	registerReviewTool(mcp, container);
	registerSyncTools(mcp, container);
	registerTaskTools(mcp, container);

	return mcp;
}
