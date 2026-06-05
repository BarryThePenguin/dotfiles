import {
	McpServer,
	type CallToolResult,
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

export type ToolResult<Schema extends StandardSchemaWithJSON> = {
	data: StandardSchemaWithJSON.InferOutput<Schema>;
	text?: string;
	track?: Record<string, string | number | boolean>;
};

type SpanOptionsCallback<InputArgs extends StandardSchemaWithJSON> = (
	args: StandardSchemaWithJSON.InferOutput<InputArgs>,
	context: ServerContext,
) => api.SpanOptions;

interface ToolConfiguration<
	OutputArgs extends StandardSchemaWithJSON,
	InputArgs extends StandardSchemaWithJSON,
> {
	mcp: McpServer;
	name: string;
	config: {
		title?: string;
		description?: string;
		inputSchema?: InputArgs;
		outputSchema?: OutputArgs;
		annotations?: ToolAnnotations;
		_meta?: Record<string, unknown>;
	};
	spanOptions?: api.SpanOptions | SpanOptionsCallback<InputArgs>;
	callback: (
		args: StandardSchemaWithJSON.InferOutput<InputArgs>,
		context: ServerContext,
	) => ToolResult<OutputArgs> | Promise<ToolResult<OutputArgs>>;
}

export function registerTool<
	OutputArgs extends StandardSchemaWithJSON,
	InputArgs extends StandardSchemaWithJSON,
>({
	mcp,
	name,
	config,
	spanOptions,
	callback,
}: ToolConfiguration<OutputArgs, InputArgs>): RegisteredTool {
	const toolCallback: ToolCallback<StandardSchemaWithJSON> = (
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
					trackOperation(name, true, result.track);
					return {
						content: [{ type: "text" as const, text: result.text ?? name }],
						structuredContent: result.data,
					} as CallToolResult;
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
