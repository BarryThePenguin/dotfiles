import { api } from "@opentelemetry/sdk-node";
import { ATTR_OPERATION, ATTR_SYNCLATENCY } from "./semconv.ts";
import type { RequestMeta } from "@modelcontextprotocol/server";

export const tracer = api.trace.getTracer("doist");

export const meter = api.metrics.getMeter("doist");

export const syncLatency = meter.createHistogram(ATTR_SYNCLATENCY, {
	description: "Sync duration in milliseconds",
	unit: "ms",
});

export const operationCounter = meter.createCounter(ATTR_OPERATION, {
	description: "Count of Todoist MCP operations",
	unit: "1",
});

export function trackOperation(
	operation: string,
	success: boolean,
	attributes?: Record<string, string | number | boolean>,
) {
	operationCounter.add(1, {
		operation,
		success,
		...attributes,
	});
}

export function setSpanAttributes(attributes: api.Attributes) {
	const span = api.trace.getActiveSpan();
	span?.setAttributes(attributes);
}

export function setSpanStatus(status: api.SpanStatus) {
	const span = api.trace.getActiveSpan();
	span?.setStatus(status);
}

export function recordException(span: api.Span, error: unknown) {
	if (error instanceof Error) {
		span.recordException(error);
	}

	span.setStatus({ code: api.SpanStatusCode.ERROR });
}

export function propagateMeta(meta?: RequestMeta): api.Context {
	return api.propagation.extract(api.context.active(), meta);
}
