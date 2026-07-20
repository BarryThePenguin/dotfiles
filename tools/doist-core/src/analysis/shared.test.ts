import { describe, expect, it } from "vitest";
import type { AppTask } from "../schema.ts";
import { taskAgeDays } from "./shared.ts";

function makeTask(
	overrides: Partial<AppTask> & { id: string; content: string },
): AppTask {
	return {
		url: `https://app.todoist.com/app/task/${overrides.id}`,
		projectId: null,
		sectionId: null,
		parentId: null,
		childOrder: 0,
		noteCount: 0,
		updatedAt: null,
		createdAt: null,
		description: null,
		priority: null,
		due: null,
		labels: [],
		isCompleted: false,
		...overrides,
	};
}

function daysAgo(n: number): string {
	const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
	return d.toISOString();
}

describe("taskAgeDays", () => {
	it("returns null when both updatedAt and createdAt are null", () => {
		const task = makeTask({
			id: "t1",
			content: "no dates",
			updatedAt: null,
			createdAt: null,
		});
		expect(taskAgeDays(task)).toBeNull();
	});

	it("uses updatedAt when both fields are set", () => {
		const task = makeTask({
			id: "t1",
			content: "recently updated old task",
			createdAt: daysAgo(200),
			updatedAt: daysAgo(5),
		});
		const age = taskAgeDays(task);
		expect(age).not.toBeNull();
		expect(age).toBeCloseTo(5, 0);
	});

	it("falls back to createdAt when updatedAt is null", () => {
		const task = makeTask({
			id: "t1",
			content: "never updated",
			createdAt: daysAgo(90),
			updatedAt: null,
		});
		const age = taskAgeDays(task);
		expect(age).not.toBeNull();
		expect(age).toBeCloseTo(90, 0);
	});

	it("a recently-updated old task does not register as old", () => {
		const task = makeTask({
			id: "t1",
			content: "old but touched recently",
			createdAt: daysAgo(400),
			updatedAt: daysAgo(3),
		});
		const age = taskAgeDays(task);
		expect(age).not.toBeNull();
		expect(age).toBeLessThan(60);
	});
});
