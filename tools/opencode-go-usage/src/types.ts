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
