import type { AppTask } from "../schema.ts";

const STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"for",
	"in",
	"of",
	"on",
	"the",
	"to",
	"with",
	"my",
]);

const VAGUE_PATTERNS = [
	/\b(plan|organi[sz]e|organize|figure out|deal with|misc|stuff|todo|follow up|catch up)\b/i,
	/\band\b/i,
];

export function normalizeTitle(title: string): string {
	return title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.split(/\s+/)
		.filter((word) => word.length > 0 && !STOPWORDS.has(word))
		.join(" ")
		.trim();
}

export function levenshtein(a: string, b: string): number {
	if (a === b) {
		return 0;
	}
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}

	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	let curr = new Array<number>(b.length + 1).fill(0);

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		const charA = a[i - 1] ?? "";
		for (let j = 1; j <= b.length; j++) {
			const charB = b[j - 1] ?? "";
			const cost = charA === charB ? 0 : 1;
			const prevJ = prev[j] ?? Number.POSITIVE_INFINITY;
			const currPrev = curr[j - 1] ?? Number.POSITIVE_INFINITY;
			const prevDiag = prev[j - 1] ?? Number.POSITIVE_INFINITY;
			curr[j] = Math.min(prevJ + 1, currPrev + 1, prevDiag + cost);
		}
		[prev, curr] = [curr, prev];
	}

	return prev[b.length] ?? 0;
}

export function similarity(a: string, b: string): number {
	const left = normalizeTitle(a);
	const right = normalizeTitle(b);
	if (left.length === 0 && right.length === 0) {
		return 1;
	}
	const maxLen = Math.max(left.length, right.length);
	if (maxLen === 0) {
		return 1;
	}
	return 1 - levenshtein(left, right) / maxLen;
}

export function taskAgeDays(task: AppTask): number | null {
	const source = task.updatedAt ?? task.createdAt;
	if (!source) {
		return null;
	}
	const age = Date.now() - new Date(source).getTime();
	return Number.isFinite(age) ? age / (1000 * 60 * 60 * 24) : null;
}

export function dueAgeDays(task: AppTask): number | null {
	if (!task.due?.date) {
		return null;
	}
	const today = new Date();
	const due = new Date(`${task.due.date}T00:00:00Z`);
	const age = today.getTime() - due.getTime();
	return Number.isFinite(age) ? age / (1000 * 60 * 60 * 24) : null;
}

export function isVagueTask(task: AppTask): boolean {
	return VAGUE_PATTERNS.some((pattern) => pattern.test(task.content));
}

export function chooseCanonical(tasks: AppTask[]): AppTask {
	const [canonicalTask] = [...tasks].sort((a, b) => {
		const scoreA =
			(a.noteCount ?? 0) * 10 + a.content.length - (a.childOrder ?? 0);
		const scoreB =
			(b.noteCount ?? 0) * 10 + b.content.length - (b.childOrder ?? 0);
		if (scoreA !== scoreB) {
			return scoreB - scoreA;
		}
		const updatedA = a.updatedAt ?? a.createdAt ?? "";
		const updatedB = b.updatedAt ?? b.createdAt ?? "";
		return updatedB.localeCompare(updatedA);
	});
	if (!canonicalTask) {
		throw new Error("chooseCanonical requires at least one task");
	}
	return canonicalTask;
}
