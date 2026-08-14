import type { Generated, Insertable, Kysely, Selectable } from "kysely";
import { SyncSqliteDatabase } from "sqlite-kysely";
import type { SqliteDriver } from "sqlite-runtime";
import type { OpenCodeGoUsage } from "./types.ts";

interface UsageCacheTable {
	cache_key: string;
	fetched_at: string;
	usage_json: string;
}

interface RoutingEventsTable {
	id: Generated<number>;
	occurred_at: string;
	agent: string | null;
	provider: string | null;
	requested_model: string | null;
	selected_model: string | null;
	policy: string;
	reason: string | null;
	rolling_percent: number | null;
	weekly_percent: number | null;
	monthly_percent: number | null;
	usage_fetched_at: string | null;
	usage_stale: number;
	outcome: string;
	duration_ms: number;
	error_kind: string | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cost: number | null;
}

type Schema = {
	usage_cache: UsageCacheTable;
	routing_events: RoutingEventsTable;
};

type UsageRow = Selectable<UsageCacheTable>;

export interface RoutingEvent {
	occurredAt: string;
	agent?: string | undefined;
	provider?: string | undefined;
	requestedModel?: string | undefined;
	selectedModel?: string | undefined;
	policy: "normal" | "fallback" | "limited" | "approved";
	reason?: string | undefined;
	rollingPercent?: number | undefined;
	weeklyPercent?: number | undefined;
	monthlyPercent?: number | undefined;
	usageFetchedAt?: string | undefined;
	usageStale: boolean;
	outcome: "success" | "failure" | "cancelled" | "timeout";
	durationMs: number;
	errorKind?: string | undefined;
	inputTokens?: number | undefined;
	outputTokens?: number | undefined;
	cost?: number | undefined;
}

export interface RoutingSummary {
	policy: string;
	selected_model: string | null;
	requests: number;
	successes: number;
	avg_duration_ms: number | null;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS usage_cache (
    cache_key   TEXT PRIMARY KEY,
    fetched_at  TEXT NOT NULL,
    usage_json  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routing_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at       TEXT NOT NULL,
    agent             TEXT,
    provider          TEXT,
    requested_model   TEXT,
    selected_model    TEXT,
    policy            TEXT NOT NULL,
    reason            TEXT,
    rolling_percent   REAL,
    weekly_percent    REAL,
    monthly_percent   REAL,
    usage_fetched_at  TEXT,
    usage_stale       INTEGER NOT NULL,
    outcome           TEXT NOT NULL,
    duration_ms       INTEGER NOT NULL,
    error_kind        TEXT,
    input_tokens      INTEGER,
    output_tokens     INTEGER,
    cost              REAL
  );
`;

interface DatabaseOptions {
	driver: SqliteDriver;
}

/** Small SQLite repository for the provider usage snapshot. */
export class Database {
	readonly #sync: SyncSqliteDatabase<Schema>;
	readonly #query: Kysely<Schema>;

	constructor({ driver }: DatabaseOptions) {
		this.#sync = new SyncSqliteDatabase({ driver });
		this.#sync.migrate(SCHEMA_SQL);
		this.#query = this.#sync.query;
	}

	close(): void {
		this.#sync.close();
	}

	getUsage(): UsageRow | undefined {
		return this.#sync.get(
			this.#query
				.selectFrom("usage_cache")
				.selectAll()
				.where("cache_key", "=", "current")
				.compile(),
		);
	}

	upsertUsage(fetchedAt: string, usage: OpenCodeGoUsage): void {
		this.#sync.run(
			this.#query
				.insertInto("usage_cache")
				.values({
					cache_key: "current",
					fetched_at: fetchedAt,
					usage_json: JSON.stringify({ usage }),
				})
				.onConflict((oc) =>
					oc.column("cache_key").doUpdateSet({
						fetched_at: fetchedAt,
						usage_json: JSON.stringify({ usage }),
					}),
				)
				.compile(),
		);
	}

	recordRoutingEvent(event: RoutingEvent): void {
		const row: Insertable<RoutingEventsTable> = {
			occurred_at: event.occurredAt,
			agent: event.agent ?? null,
			provider: event.provider ?? null,
			requested_model: event.requestedModel ?? null,
			selected_model: event.selectedModel ?? null,
			policy: event.policy,
			reason: event.reason ?? null,
			rolling_percent: event.rollingPercent ?? null,
			weekly_percent: event.weeklyPercent ?? null,
			monthly_percent: event.monthlyPercent ?? null,
			usage_fetched_at: event.usageFetchedAt ?? null,
			usage_stale: event.usageStale ? 1 : 0,
			outcome: event.outcome,
			duration_ms: event.durationMs,
			error_kind: event.errorKind ?? null,
			input_tokens: event.inputTokens ?? null,
			output_tokens: event.outputTokens ?? null,
			cost: event.cost ?? null,
		};
		this.#sync.run(
			this.#query.insertInto("routing_events").values(row).compile(),
		);
	}

	routingSummary(): RoutingSummary[] {
		return this.#sync.all(
			this.#query
				.selectFrom("routing_events")
				.select([
					"policy",
					"selected_model",
					(eb) => eb.fn.countAll<number>().as("requests"),
					(eb) =>
						eb.fn
							.sum<number>(
								eb.case().when("outcome", "=", "success").then(1).else(0).end(),
							)
							.as("successes"),
					(eb) => eb.fn.avg<number>("duration_ms").as("avg_duration_ms"),
				])
				.groupBy(["policy", "selected_model"])
				.orderBy("requests", "desc")
				.compile(),
		);
	}
}
