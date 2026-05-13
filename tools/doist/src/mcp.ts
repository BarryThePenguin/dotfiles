#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server";
import { buildServer } from "./server.ts";

const { server, db } = buildServer();

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);

function shutdown() {
	db.close();
	process.exit(0);
}
