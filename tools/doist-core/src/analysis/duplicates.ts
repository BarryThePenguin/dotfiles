import type { AppTask } from "../schema.ts";
import { chooseCanonical, normalizeTitle, similarity } from "./shared.ts";

export type DuplicateMatchType = "exact" | "fuzzy";
export type DuplicateRecommendationCode = "merge" | "review" | "ignore";

export type DuplicateMatch = {
	task: AppTask;
	similarity: number;
};

export type DuplicateGroup = {
	canonicalTask: AppTask;
	matches: DuplicateMatch[];
	matchType: DuplicateMatchType;
	score: number;
	reason: string;
	recommendationCode: DuplicateRecommendationCode;
	recommendationText: string;
};

export type DuplicateAnalysis = {
	groups: DuplicateGroup[];
	candidates: number;
	exactGroups: number;
	fuzzyGroups: number;
};

type NormalizedTask = {
	task: AppTask;
	title: string;
};

function recommendationForDuplicate(matchType: DuplicateMatchType): {
	code: DuplicateRecommendationCode;
	text: string;
} {
	if (matchType === "exact") {
		return { code: "merge", text: "Merge into one canonical task." };
	}
	return { code: "review", text: "Review before merging." };
}

function filterDuplicateCandidates(tasks: AppTask[]): AppTask[] {
	const nonRecurring = tasks.filter((t) => !t.due?.isRecurring);
	const recurring = tasks.filter((t) => t.due?.isRecurring);
	const recurringBySchedule = new Map<string, AppTask[]>();
	for (const task of recurring) {
		const key = task.due?.string;

		if (key) {
			const bucket = recurringBySchedule.get(key) ?? [];
			bucket.push(task);
			recurringBySchedule.set(key, bucket);
		}
	}
	const result = [...nonRecurring];
	for (const bucket of recurringBySchedule.values()) {
		if (bucket.length >= 2 || nonRecurring.length > 0) {
			result.push(...bucket);
		}
	}
	return result;
}

export function findDuplicateCandidates(tasks: AppTask[]): DuplicateAnalysis {
	const normalized: NormalizedTask[] = tasks.map((task) => ({
		task,
		title: normalizeTitle(task.content),
	}));

	const exactGroups: DuplicateGroup[] = [];
	const used = new Set<string>();

	const exactMap = new Map<string, NormalizedTask[]>();
	for (const entry of normalized) {
		const bucket = exactMap.get(entry.title) ?? [];
		bucket.push(entry);
		exactMap.set(entry.title, bucket);
	}

	for (const [title, group] of exactMap.entries()) {
		if (group.length < 2 || title.length === 0) {
			continue;
		}
		const allTasks = group.map((entry) => entry.task);
		// Mark all tasks in this title group as handled so the fuzzy pass
		// never re-examines recurring tasks that differ only by schedule.
		for (const task of allTasks) {
			used.add(task.id);
		}
		const tasksInGroup = filterDuplicateCandidates(allTasks);
		if (tasksInGroup.length < 2) {
			continue;
		}
		const canonicalTask = chooseCanonical(tasksInGroup);
		const recommendation = recommendationForDuplicate("exact");
		const matches = tasksInGroup
			.filter((task) => task.id !== canonicalTask.id)
			.map((task) => ({ task, similarity: 1 }));
		exactGroups.push({
			canonicalTask,
			matches,
			matchType: "exact",
			score: 1,
			reason: `Normalized title matches "${title}"`,
			recommendationCode: recommendation.code,
			recommendationText: recommendation.text,
		});
	}

	const remaining = normalized.filter((entry) => !used.has(entry.task.id));
	const edges = new Map<string, Set<string>>();

	function connect(a: string, b: string): void {
		if (!edges.has(a)) {
			edges.set(a, new Set());
		}
		if (!edges.has(b)) {
			edges.set(b, new Set());
		}
		edges.get(a)?.add(b);
		edges.get(b)?.add(a);
	}

	for (let i = 0; i < remaining.length; i++) {
		for (let j = i + 1; j < remaining.length; j++) {
			const left = remaining[i]?.task;
			const right = remaining[j]?.task;
			if (!left || !right) {
				continue;
			}
			const score = similarity(left.content, right.content);
			if (score >= 0.85) {
				connect(left.id, right.id);
			}
		}
	}

	const seen = new Set<string>();
	const fuzzyGroups: DuplicateGroup[] = [];

	for (const entry of remaining) {
		if (seen.has(entry.task.id)) {
			continue;
		}
		const stack = [entry.task.id];
		const component = new Set<string>();
		while (stack.length > 0) {
			const id = stack.pop();
			if (!id || component.has(id)) {
				continue;
			}
			component.add(id);
			seen.add(id);
			for (const neighbor of edges.get(id) ?? []) {
				if (!component.has(neighbor)) {
					stack.push(neighbor);
				}
			}
		}
		if (component.size < 2) {
			continue;
		}
		const tasksInGroup = remaining
			.filter((item) => component.has(item.task.id))
			.map((item) => item.task);
		const canonicalTask = chooseCanonical(tasksInGroup);
		const recommendation = recommendationForDuplicate("fuzzy");
		const matches = tasksInGroup
			.filter((task) => task.id !== canonicalTask.id)
			.map((task) => ({
				task,
				similarity: similarity(canonicalTask.content, task.content),
			}))
			.sort((a, b) => b.similarity - a.similarity);
		const best = matches[0]?.similarity ?? 0;
		fuzzyGroups.push({
			canonicalTask,
			matches,
			matchType: "fuzzy",
			score: best,
			reason: "Titles are similar after normalization.",
			recommendationCode: recommendation.code,
			recommendationText: recommendation.text,
		});
	}

	const groups = [...exactGroups, ...fuzzyGroups].sort(
		(a, b) => b.score - a.score,
	);
	return {
		groups,
		candidates: groups.reduce(
			(sum, group) => sum + 1 + group.matches.length,
			0,
		),
		exactGroups: exactGroups.length,
		fuzzyGroups: fuzzyGroups.length,
	};
}
