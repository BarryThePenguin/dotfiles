import type { UsageResult } from "opencode-go-usage";

export const GO_USAGE_STATUS_KEY = "opencode-go-usage";

export function formatGoUsageStatus(result: UsageResult): {
	text: string;
	color: "accent" | "warning" | "error" | "dim";
} {
	if (!result.usage) {
		return { text: "Go --", color: "dim" };
	}

	const windows = [
		result.usage.rolling,
		result.usage.weekly,
		result.usage.monthly,
	];
	const highest = Math.max(...windows.map((window) => window.percent));
	const color = highest >= 90 ? "error" : highest >= 75 ? "warning" : "accent";
	const stale = result.stale ? "?" : "";
	const warning = result.error ? "!" : "";

	return {
		text: `Go ${formatPercent(result.usage.rolling.percent)}r/${formatPercent(result.usage.weekly.percent)}w/${formatPercent(result.usage.monthly.percent)}m${stale}${warning}`,
		color,
	};
}

function formatPercent(percent: number): string {
	return `${Math.round(percent)}%`;
}
