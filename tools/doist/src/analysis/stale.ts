import type { AppTask } from "../schema.ts";
import { dueAgeDays, isVagueTask, taskAgeDays } from "./shared.ts";

export type StaleRecommendationCode = "complete" | "rewrite" | "defer" | "keep";

export type StaleCandidate = {
	task: AppTask;
	signals: string[];
	score: number;
	recommendationCode: StaleRecommendationCode;
	recommendationText: string;
};

export type StaleAnalysis = {
	candidates: StaleCandidate[];
};

function recommendationForStale(score: number): {
	code: StaleRecommendationCode;
	text: string;
} {
	if (score >= 6) {
		return {
			code: "complete",
			text: "Looks stale enough to complete or rewrite.",
		};
	}
	if (score >= 4) {
		return { code: "rewrite", text: "Rewrite into a clearer next action." };
	}
	if (score >= 2) {
		return { code: "defer", text: "Defer until the task becomes actionable." };
	}
	return { code: "keep", text: "Keep for now." };
}

export function findStaleCandidates(
	tasks: AppTask[],
	inboxProjectId: string | null,
): StaleAnalysis {
	const today = new Date();

	const candidates = tasks
		.map((task) => {
			let score = 0;
			const signals: string[] = [];

			const ageDays = taskAgeDays(task);
			if (ageDays !== null && ageDays > 60) {
				score += 2;
				signals.push(`older than 60 days (${Math.round(ageDays)}d)`);
			}

			const updatedAgeDays = task.updatedAt
				? (today.getTime() - new Date(task.updatedAt).getTime()) /
					(1000 * 60 * 60 * 24)
				: null;
			if (updatedAgeDays !== null && updatedAgeDays > 60) {
				score += 1;
				signals.push(`not updated for ${Math.round(updatedAgeDays)} days`);
			}

			const dueAge = dueAgeDays(task);
			if (dueAge !== null && dueAge > 14) {
				score += 4;
				signals.push(`overdue by ${Math.round(dueAge)} days`);
			}

			if (!task.due && (ageDays ?? 0) > 60) {
				score += 1;
				signals.push("no due date");
			}

			if (task.projectId === inboxProjectId && inboxProjectId !== null && (ageDays ?? 0) > 7) {
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

			const recommendation = recommendationForStale(score);
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
