import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { Database, type RoutingEvent, type RoutingSummary } from "./db.ts";

export { Database } from "./db.ts";
export type { RoutingEvent, RoutingSummary } from "./db.ts";
export type { SqliteDriver, SqliteStatement } from "sqlite-runtime";

export const DEFAULT_USAGE_ENDPOINT = "https://opencode.ai/zen/go/v1/usage";
export const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

export interface UsageWindow {
	percent: number;
	resetsAt: string;
}

export interface OpenCodeGoUsage {
	rolling: UsageWindow;
	weekly: UsageWindow;
	monthly: UsageWindow;
	[key: string]: UsageWindow;
}

export interface UsageSnapshot {
	usage: OpenCodeGoUsage;
	fetchedAt: string;
	stale: boolean;
	source: "network" | "cache";
	error?: string;
}

export interface UsageUnavailable {
	usage: null;
	stale: boolean;
	source: "none" | "cache";
	error: string;
}

export type UsageResult = UsageSnapshot | UsageUnavailable;

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

interface CacheRecord {
	fetchedAt: string;
	usage: OpenCodeGoUsage;
}

export interface OpenCodeGoUsageClientOptions {
	apiKey?: string;
	endpoint?: string;
	/** Directory containing the SQLite cache. */
	cacheDirectory?: string;
	/** Override the SQLite database location, primarily useful for tests. */
	databasePath?: string;
	/** Injectable fetch implementation for tests and alternate runtimes. */
	fetch?: typeof fetch;
	cacheTtlMs?: number;
	timeoutMs?: number;
	now?: () => number;
}

export function defaultCacheDirectory(): string {
	return join(
		process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"),
		"opencode-go",
	);
}

export function defaultDatabasePath(): string {
	return join(defaultCacheDirectory(), "usage.sqlite");
}

export class OpenCodeGoUsageClient {
	private readonly apiKey: string | undefined;
	private readonly endpoint: string;
	private readonly databasePath: string;
	private readonly cacheTtlMs: number;
	private database: Database | undefined;
	private readonly timeoutMs: number;
	private readonly fetcher: typeof fetch;
	private readonly now: () => number;
	private memory: CacheRecord | undefined;

	constructor(options: OpenCodeGoUsageClientOptions = {}) {
		this.apiKey = options.apiKey ?? process.env["OPENCODE_API_KEY"];
		this.endpoint = options.endpoint ?? DEFAULT_USAGE_ENDPOINT;
		this.databasePath =
			options.databasePath ??
			join(options.cacheDirectory ?? defaultCacheDirectory(), "usage.sqlite");
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.timeoutMs = options.timeoutMs ?? 5_000;
		this.fetcher = options.fetch ?? fetch;
		this.now = options.now ?? Date.now;
	}

	async get(): Promise<UsageResult> {
		const cached = await this.readCache();
		if (cached && this.isFresh(cached)) {
			return this.snapshot(cached, "cache");
		}

		if (!this.apiKey) {
			return this.unavailable("OPENCODE_API_KEY is not set", cached);
		}

		try {
			const usage = await this.fetchUsage();
			const record: CacheRecord = {
				usage,
				fetchedAt: new Date(this.now()).toISOString(),
			};
			this.memory = record;
			await this.writeCache(record);
			return this.snapshot(record, "network");
		} catch (error) {
			return this.unavailable(errorMessage(error), cached);
		}
	}

	private async fetchUsage(): Promise<OpenCodeGoUsage> {
		const response = await this.fetcher(this.endpoint, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (!response.ok) {
			throw new Error(`usage request failed (${response.status})`);
		}
		return parseUsage(await response.json());
	}

	private async readCache(): Promise<CacheRecord | undefined> {
		if (this.memory) {
			return this.memory;
		}
		try {
			const row = (await this.openDatabase()).getUsage();
			if (!row) {
				return undefined;
			}
			const usage = parseUsage(JSON.parse(row.usage_json));
			this.memory = { fetchedAt: row.fetched_at, usage };
			return this.memory;
		} catch {
			return undefined;
		}
	}

	private async writeCache(record: CacheRecord): Promise<void> {
		try {
			(await this.openDatabase()).upsertUsage(record.fetchedAt, record.usage);
		} catch {
			// A read-only home or a competing process must not break usage checks.
		}
	}

	private async openDatabase(): Promise<Database> {
		if (this.database) {
			return this.database;
		}
		await mkdir(dirname(this.databasePath), { recursive: true, mode: 0o700 });
		this.database = new Database(this.databasePath);
		return this.database;
	}

	close(): void {
		this.database?.close();
		this.database = undefined;
	}

	private isFresh(record: CacheRecord): boolean {
		return this.now() - Date.parse(record.fetchedAt) < this.cacheTtlMs;
	}

	private snapshot(
		record: CacheRecord,
		source: "network" | "cache",
	): UsageSnapshot {
		return {
			...record,
			stale: source === "cache" && !this.isFresh(record),
			source,
		};
	}

	private unavailable(error: string, cached?: CacheRecord): UsageResult {
		if (cached) {
			return { ...this.snapshot(cached, "cache"), stale: true, error };
		}
		return { usage: null, stale: false, source: "none", error };
	}
}

const UsageWindowSchema = v.object({
	percent: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100)),
	resetsAt: v.string(),
});

const UsageResponseSchema = v.object({
	usage: v.record(v.string(), v.unknown()),
});

function parseUsage(value: unknown): OpenCodeGoUsage {
	const response = v.safeParse(UsageResponseSchema, value);
	if (!response.success) {
		throw new Error("usage response has no usage object");
	}

	const windows: Record<string, UsageWindow> = {};
	for (const [name, raw] of Object.entries(response.output.usage)) {
		const parsed = v.safeParse(UsageWindowSchema, raw);
		if (!parsed.success) {
			throw new Error(`invalid ${name} window`);
		}
		windows[name] = parsed.output;
	}
	if (
		!("rolling" in windows) ||
		!("weekly" in windows) ||
		!("monthly" in windows)
	) {
		throw new Error("usage response is missing a required window");
	}
	return windows as OpenCodeGoUsage;
}

export function classifyError(error: unknown): string {
	const message = error instanceof Error ? error.message.toLowerCase() : "";
	if (
		message.includes("401") ||
		message.includes("403") ||
		message.includes("auth")
	)
		{return "auth";}
	if (message.includes("429") || message.includes("rate"))
		{return "rate_limited";}
	if (message.includes("quota") || message.includes("limit"))
		{return "quota_exceeded";}
	if (message.includes("timeout") || message.includes("abort"))
		{return "timeout";}
	if (message.includes("network") || message.includes("fetch"))
		{return "network";}
	return "unknown";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "usage request failed";
}
