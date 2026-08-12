/**
 * Small host boundary for the native SQLite implementations used by Bun and
 * Node. Consumers own their schema and query layer; this package only owns
 * the compatible driver shape and runtime selection.
 */
/** Values accepted by native SQLite prepared statements. */

export type SQLInputValue = null | number | bigint | string | Uint8Array;

export interface SqliteRunResult {
	changes: number | bigint;
	lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
	run(...params: SQLInputValue[]): SqliteRunResult;
	get(...params: SQLInputValue[]): unknown;
	all(...params: SQLInputValue[]): unknown[];
}

export interface SqliteDriver {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	close(): void;
}

export type DriverFactory = (dbPath: string) => SqliteDriver;

let driverFactory: DriverFactory;

try {
	const { Database } = await import("bun:sqlite");
	driverFactory = (dbPath: string) => new Database(dbPath);
} catch {
	const { DatabaseSync } = await import("node:sqlite");
	driverFactory = (dbPath: string) => new DatabaseSync(dbPath);
}

/** Native SQLite driver for the current host runtime. */
export { driverFactory };
