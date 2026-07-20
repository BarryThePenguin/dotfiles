#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./server.ts";
import { createContainer } from "doist-core";
import { shutdown } from "./instrumentation.ts";

const container = createContainer();
const server = buildServer(container);

process.on("SIGTERM", close(130));
process.on("SIGINT", close(143));

const transport = new StdioServerTransport();
await server.connect(transport);

function close(code = 0) {
	return () => {
		container.close();
		void shutdown()
			.catch(console.error)
			.finally(() => {
				process.exit(code);
			});
	};
}
