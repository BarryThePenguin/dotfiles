import {
	McpServer,
	type RegisteredTool,
	type ServerContext,
	type StandardSchemaWithJSON,
	type ToolAnnotations,
	type ToolCallback,
} from "@modelcontextprotocol/server";
import type { api } from "@opentelemetry/sdk-node";
import {
	propagateContext,
	recordException,
	tracer,
	trackOperation,
} from "../telemetry.ts";

type SpanOptionsCallback<InputArgs extends StandardSchemaWithJSON> = (
	args: StandardSchemaWithJSON.InferOutput<InputArgs>,
	context: ServerContext,
) => api.SpanOptions;

interface ToolConfiguration<InputArgs extends StandardSchemaWithJSON> {
	mcp: McpServer;
	name: string;
	config: {
		title?: string;
		description?: string;
		inputSchema?: InputArgs;
		outputSchema?: StandardSchemaWithJSON;
		annotations?: ToolAnnotations;
		_meta?: Record<string, unknown>;
	};
	spanOptions?: api.SpanOptions | SpanOptionsCallback<InputArgs>;
	callback: ToolCallback<InputArgs>;
}

export function registerTool<InputArgs extends StandardSchemaWithJSON>({
	mcp,
	name,
	config,
	spanOptions,
	callback,
}: ToolConfiguration<InputArgs>): RegisteredTool {
	const toolCallback: ToolCallback<StandardSchemaWithJSON | undefined> = (
		inputArgs,
		context,
	) => {
		const resolvedSpanOptions =
			typeof spanOptions === "function"
				? spanOptions(inputArgs, context)
				: spanOptions;

		return tracer.startActiveSpan(
			name,
			resolvedSpanOptions ?? {},
			propagateContext(context),
			async (span) => {
				try {
					const result = await callback(inputArgs, context);
					return result;
				} catch (err) {
					recordException(span, err);
					trackOperation(name, false);
					throw err;
				} finally {
					span.end();
				}
			},
		);
	};

	return mcp.registerTool(
		name,
		config,
		toolCallback as ToolCallback<InputArgs>,
	);
}
