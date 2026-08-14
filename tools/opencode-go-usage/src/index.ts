import { join } from "node:path";
import { driverFactory } from "sqlite-runtime";
import { defaultCacheDirectory } from "./client.ts";
import { Database, type RoutingEvent, type RoutingSummary } from "./db.ts";

export type { SqliteDriver, SqliteStatement } from "sqlite-runtime";
export { classifyError, OpenCodeGoUsageClient } from "./client.ts";
export { Database } from "./db.ts";
export type { RoutingEvent, RoutingSummary } from "./db.ts";
export type { UsageResult } from "./types.ts";

export interface RoutingMetricsOptions {
	databasePath?: string;
	cacheDirectory?: string;
}

/** Best-effort local metrics for evaluating model-routing decisions. */
export class RoutingMetrics {
	private database: Database;

	constructor(options: RoutingMetricsOptions = {}) {
		this.database = new Database({
			driver: driverFactory(
				options.databasePath ??
					join(
						options.cacheDirectory ?? defaultCacheDirectory(),
						"usage.sqlite",
					),
			),
		});
	}

	record(event: RoutingEvent): void {
		try {
			this.database.recordRoutingEvent(event);
		} catch {
			// Metrics must never make an agent invocation fail.
		}
	}

	summary(): RoutingSummary[] {
		try {
			return this.database.routingSummary();
		} catch {
			return [];
		}
	}

	close(): void {
		this.database.close();
	}
}
