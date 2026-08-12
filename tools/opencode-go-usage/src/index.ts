import { join } from "node:path";
import { defaultCacheDirectory } from "./client.ts";
import { Database, type RoutingEvent, type RoutingSummary } from "./db.ts";

export { OpenCodeGoUsageClient, classifyError } from "./client.ts";
export { Database } from "./db.ts";
export type { RoutingEvent, RoutingSummary } from "./db.ts";
export type { SqliteDriver, SqliteStatement } from "sqlite-runtime";

export interface RoutingMetricsOptions {
	databasePath?: string;
	cacheDirectory?: string;
}

/** Best-effort local metrics for evaluating model-routing decisions. */
export class RoutingMetrics {
	private readonly databasePath: string;
	private database: Database | undefined;

	constructor(options: RoutingMetricsOptions = {}) {
		this.databasePath =
			options.databasePath ??
			join(options.cacheDirectory ?? defaultCacheDirectory(), "usage.sqlite");
	}

	private getDatabase(): Database {
		return (this.database ??= new Database(this.databasePath));
	}

	record(event: RoutingEvent): void {
		try {
			this.getDatabase().recordRoutingEvent(event);
		} catch {
			// Metrics must never make an agent invocation fail.
		}
	}

	summary(): RoutingSummary[] {
		try {
			return this.getDatabase().routingSummary();
		} catch {
			return [];
		}
	}

	close(): void {
		this.database?.close();
		this.database = undefined;
	}
}
