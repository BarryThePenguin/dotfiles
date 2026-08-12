import type { UsageResult, UsageWindow } from "./types.ts";

const WINDOW_ORDER = ["rolling", "weekly", "monthly"] as const;

export function formatUsage(result: UsageResult, now = Date.now()): string {
	if (!result.usage) {
		return `OpenCode Go usage unavailable: ${result.error}`;
	}

	const lines = [
		`OpenCode Go usage${result.stale ? " (stale)" : ""}`,
		...WINDOW_ORDER.map((name) => formatWindow(name, result.usage[name], now)),
		`fetched: ${formatDate(result.fetchedAt)}`,
	];
	if (result.error) {
		lines.push(`warning: ${result.error}`);
	}
	return lines.join("\n");
}

function formatWindow(name: string, window: UsageWindow, now: number): string {
	const reset = formatReset(window.resetsAt, now);
	return `  ${name.padEnd(7)} ${formatPercent(window.percent)}  (resets ${reset})`;
}

function formatPercent(percent: number): string {
	return `${percent.toFixed(1).replace(/\.0$/, "").padStart(5)}%`;
}

function formatReset(value: string, now: number): string {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		return value;
	}
	const delta = timestamp - now;
	if (delta <= 0) {
		return "now";
	}
	const minutes = Math.ceil(delta / 60_000);
	if (minutes < 60) {
		return `in ${minutes}m`;
	}
	const hours = Math.ceil(minutes / 60);
	if (hours < 48) {
		return `in ${hours}h`;
	}
	return `in ${Math.ceil(hours / 24)}d`;
}

function formatDate(value: string): string {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

export function isStrictFailure(result: UsageResult): boolean {
	return !result.usage || result.stale || Boolean(result.error);
}

export function asJson(result: UsageResult): UsageResult {
	return result;
}
