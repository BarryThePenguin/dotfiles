import type { AppProject, AppTask } from "../schema.ts";
import { dueAgeDays, isVagueTask, taskAgeDays } from "./shared.ts";

export type StaleRecommendationCode =
	| "complete"
	| "rewrite"
	| "reschedule"
	| "schedule"
	| "keep";

export type StaleCandidate = {
	task: AppTask;
	signals: string[];
	score: number;
	recommendationCode: StaleRecommendationCode;
	recommendationText: string;
};

export type StaleProjectGroup = {
	projectId: string;
	projectName: string;
	candidates: StaleCandidate[];
};

export type StaleAnalysis = {
	candidates: StaleCandidate[];
};

function recommendationForStale(
	score: number,
	isOverdue: boolean,
	isUndated: boolean,
): {
	code: StaleRecommendationCode;
	text: string;
} {
	if (isOverdue) {
		// High score means overdue + vague + old — likely abandoned
		if (score >= 8) {
			return {
				code: "complete",
				text: "Long overdue and stale — consider dropping it.",
			};
		}
		return { code: "reschedule", text: "Pick a new due date or remove it." };
	}
	if (score >= 6) {
		return {
			code: "complete",
			text: "Looks stale enough to complete or rewrite.",
		};
	}
	if (score >= 4) {
		return { code: "rewrite", text: "Rewrite into a clearer next action." };
	}
	if (isUndated && score >= 2) {
		return { code: "schedule", text: "Add a date, rewrite, or drop it." };
	}
	if (score >= 2) {
		return { code: "rewrite", text: "Rewrite into a clearer next action." };
	}
	return { code: "keep", text: "Keep for now." };
}

export function groupStaleByProject(
	candidates: StaleCandidate[],
	projects: AppProject[],
): StaleProjectGroup[] {
	const projectMap = new Map(projects.map((p) => [p.id, p.name]));
	const groups = new Map<string, StaleCandidate[]>();

	for (const candidate of candidates) {
		const projectId = candidate.task.projectId ?? "unknown";
		if (!groups.has(projectId)) {
			groups.set(projectId, []);
		}
		const bucket = groups.get(projectId) ?? [];
		bucket.push(candidate);
	}

	return Array.from(groups.entries()).map(([projectId, groupCandidates]) => ({
		projectId,
		projectName: projectMap.get(projectId) ?? "Unknown Project",
		candidates: groupCandidates,
	}));
}

export function findStaleCandidates(
	tasks: AppTask[],
	inboxProjectId: string | null,
): StaleAnalysis {
	const dateClusters = new Map<string, number>();
	for (const task of tasks) {
		if (task.due?.date && task.projectId) {
			const key = `${task.projectId}:${task.due.date}`;
			dateClusters.set(key, (dateClusters.get(key) ?? 0) + 1);
		}
	}

	const candidates = tasks
		.filter((task) => !task.due?.isRecurring)
		.filter((task) => !task.labels.includes("thoughts"))
		.map((task) => {
			let score = 0;
			const signals: string[] = [];

			const ageDays = taskAgeDays(task);
			if (ageDays !== null && ageDays > 60) {
				score += 2;
				signals.push(`older than 60 days (${Math.round(ageDays)}d)`);
			}

			const dueAge = dueAgeDays(task);
			if (dueAge !== null && dueAge > 14) {
				score += 4;
				signals.push(`overdue by ${Math.round(dueAge)} days`);
			} else if (dueAge !== null && dueAge > 3) {
				score += 2;
				signals.push(`overdue by ${Math.round(dueAge)} days`);
			}

			if (!task.due && (ageDays ?? 0) > 60) {
				score += 1;
				signals.push("no due date");
			}

			if (
				task.projectId === inboxProjectId &&
				inboxProjectId !== null &&
				(ageDays ?? 0) > 7
			) {
				score += 3;
				signals.push(`stuck in inbox for ${Math.round(ageDays ?? 0)} days`);
			}

			if (task.parentId !== null) {
				score += 1;
				signals.push("nested sub-task");
			}

			if ((task.noteCount ?? 0) === 0 && (ageDays ?? 0) > 30) {
				score += 1;
				signals.push("no notes for a long time");
			}

			if (isVagueTask(task)) {
				score += 2;
				signals.push("vague wording");
			}

			const clusterKey =
				task.due?.date && task.projectId
					? `${task.projectId}:${task.due.date}`
					: null;
			const clusterSize = clusterKey
				? (dateClusters.get(clusterKey) ?? 1)
				: 1;
			if (clusterSize >= 4) {
				score += 2;
				signals.push(
					`same date as ${clusterSize - 1} other tasks in this project`,
				);
			}

			const isOverdue = dueAge !== null && dueAge > 0;
			const isUndated = task.due === null;
			const recommendation = recommendationForStale(
				score,
				isOverdue,
				isUndated,
			);
			return {
				task,
				signals,
				score,
				recommendationCode: recommendation.code,
				recommendationText: recommendation.text,
			};
		})
		.filter((candidate) => candidate.score >= 2)
		.sort((a, b) => b.score - a.score);

	return { candidates };
}
