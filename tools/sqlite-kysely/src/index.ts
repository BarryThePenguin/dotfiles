import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	DummyDriver,
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type CompiledQuery,
	type QueryResult,
} from "kysely";
import type { SQLInputValue, SqliteDriver } from "sqlite-runtime";

export interface SyncSqliteDatabaseOptions {
	driver: SqliteDriver;
	telemetry?: {
		tracerName?: string;
		meterName?: string;
		recordQueryText?: boolean;
	};
}

const DB_QUERY_SPAN = "db.query";
const DB_TRANSACTION_SPAN = "db.transaction";

/** Kysely's type-safe query builder with synchronous SQLite execution. */
export class SyncSqliteDatabase<Schema extends Record<string, unknown>> {
	readonly #raw: SqliteDriver;
	readonly #db: Kysely<Schema>;
	readonly #tracer;
	readonly #queryDuration;
	readonly #queryErrors;
	readonly #recordQueryText: boolean;

	constructor(options: SyncSqliteDatabaseOptions) {
		this.#raw = options.driver;
		const tracer = trace.getTracer(
			options.telemetry?.tracerName ?? "sqlite-kysely",
		);
		const meter = metrics.getMeter(
			options.telemetry?.meterName ?? "sqlite-kysely",
		);
		this.#tracer = tracer;
		this.#queryDuration = meter.createHistogram("db.query.duration", {
			description: "Synchronous SQLite query duration",
			unit: "ms",
		});
		this.#queryErrors = meter.createCounter("db.query.errors", {
			description: "Synchronous SQLite query errors",
			unit: "1",
		});
		this.#recordQueryText = options.telemetry?.recordQueryText ?? true;
		this.#db = new Kysely<Schema>({
			dialect: {
				createAdapter: () => new SqliteAdapter(),
				createDriver: () => new DummyDriver(),
				createIntrospector: (db) => new SqliteIntrospector(db),
				createQueryCompiler: () => new SqliteQueryCompiler(),
			},
		});
	}

	/** Kysely query builder. Queries are compiled, not executed by Kysely. */
	get query(): Kysely<Schema> {
		return this.#db;
	}

	all<R>(query: CompiledQuery<R>): R[] {
		return this.execute(
			query,
			(statement, args) => statement.all(...args) as R[],
		);
	}

	get<R>(query: CompiledQuery<R>): R | undefined {
		return this.execute(
			query,
			(statement, args) => statement.get(...args) as R | undefined,
		);
	}

	run(query: CompiledQuery): QueryResult<unknown> {
		return this.execute(query, (statement, args) => {
			const result = statement.run(...args);
			return {
				rows: [],
				insertId: BigInt(result.lastInsertRowid),
				numAffectedRows: BigInt(result.changes),
			};
		});
	}

	transaction<T>(fn: () => T): T {
		return this.#tracer.startActiveSpan(DB_TRANSACTION_SPAN, (span) => {
			this.#raw.exec("BEGIN");
			try {
				const result = fn();
				this.#raw.exec("COMMIT");
				return result;
			} catch (error) {
				this.#raw.exec("ROLLBACK");
				span.recordException(error as Error);
				span.setStatus({ code: SpanStatusCode.ERROR });
				throw error;
			} finally {
				span.end();
			}
		});
	}

	private execute<R>(
		query: CompiledQuery,
		operation: (
			statement: ReturnType<SqliteDriver["prepare"]>,
			args: SQLInputValue[],
		) => R,
	): R {
		const startedAt = performance.now();
		const attributes = {
			"db.system.name": "sqlite",
			"db.operation.name":
				query.sql.trim().split(" ", 1)[0]?.toUpperCase() ?? "QUERY",
			...(this.#recordQueryText ? { "db.query.text": query.sql } : {}),
		};
		return this.#tracer.startActiveSpan(
			DB_QUERY_SPAN,
			{ attributes },
			(span) => {
				try {
					return operation(this.#raw.prepare(query.sql), parameters(query));
				} catch (error) {
					this.#queryErrors.add(1, attributes);
					span.recordException(error as Error);
					span.setStatus({ code: SpanStatusCode.ERROR });
					throw error;
				} finally {
					this.#queryDuration.record(performance.now() - startedAt, attributes);
					span.end();
				}
			},
		);
	}

	close(): void {
		this.#raw.close();
	}
}

function parameters(query: CompiledQuery): SQLInputValue[] {
	return Array.isArray(query.parameters)
		? (query.parameters as SQLInputValue[])
		: [];
}
