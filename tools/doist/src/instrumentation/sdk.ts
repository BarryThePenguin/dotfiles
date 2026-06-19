import "../loader.js";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
	logs,
	metrics,
	NodeSDK,
	resources,
	tracing,
} from "@opentelemetry/sdk-node";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { basename } from "path";
import { argv } from "process";
import pkg from "../../package.json" with { type: "json" };
import {
	ATTR_COMMANDLINE,
	ATTR_PROCESS_COMMAND_ARGS,
	ATTR_PROCESS_EXECUTABLE_NAME,
	ATTR_PROCESS_EXECUTABLE_PATH,
	ATTR_PROCESS_PID,
} from "../semconv.ts";

const executableName = basename(process.execPath);

let sdk: NodeSDK;

export function start(serviceName: string) {
	const traceExporter = new OTLPTraceExporter();

	sdk = new NodeSDK({
		instrumentations: [new PinoInstrumentation(), new UndiciInstrumentation()],
		logRecordProcessors: [
			new logs.BatchLogRecordProcessor(new OTLPLogExporter()),
		],
		metricReaders: [
			new metrics.PeriodicExportingMetricReader({
				exporter: new OTLPMetricExporter(),
			}),
		],
		resource: resources.resourceFromAttributes({
			[ATTR_SERVICE_NAME]: serviceName,
			[ATTR_SERVICE_VERSION]: pkg.version,
			[ATTR_PROCESS_EXECUTABLE_NAME]: executableName,
			[ATTR_PROCESS_EXECUTABLE_PATH]: process.execPath,
			[ATTR_PROCESS_COMMAND_ARGS]: argv,
			[ATTR_COMMANDLINE]: argv.join(" "),
			[ATTR_PROCESS_PID]: process.pid,
		}),
		traceExporter,
		spanProcessors: [new tracing.BatchSpanProcessor(traceExporter)],
	});

	sdk.start();
}

export function shutdown() {
	return sdk.shutdown();
}
