import { describe, expect, it } from "vitest";
import type { AppTask } from "../schema.ts";
import { findDuplicateCandidates } from "./duplicates.ts";

function makeTask(overrides: Partial<AppTask> & { id: string; content: string }): AppTask {
	return {
		url: `https://app.todoist.com/app/task/${overrides.id}`,
		projectId: "proj-1",
		sectionId: null,
		parentId: null,
		childOrder: 0,
		noteCount: 0,
		updatedAt: "2026-01-01T00:00:00Z",
		description: null,
		priority: 1,
		due: null,
		labels: [],
		isCompleted: false,
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("findDuplicateCandidates", () => {
	it("groups tasks with identical titles as exact duplicates", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Buy milk" }),
			makeTask({ id: "t2", content: "Buy milk" }),
		];
		const result = findDuplicateCandidates(tasks);
		expect(result.exactGroups).toBe(1);
		expect(result.groups[0]?.matchType).toBe("exact");
	});

	it("does not group recurring tasks with same title but different recurrence times", () => {
		const tasks = [
			makeTask({
				id: "t1",
				content: "Brush teeth",
				due: { date: "2026-06-19T06:00:00", string: "every day at 6am", isRecurring: true },
			}),
			makeTask({
				id: "t2",
				content: "Brush teeth",
				due: { date: "2026-06-18T21:30:00", string: "every day at 9:30pm", isRecurring: true },
			}),
		];
		const result = findDuplicateCandidates(tasks);
		expect(result.exactGroups).toBe(0);
		expect(result.groups).toHaveLength(0);
	});

	it("still groups recurring tasks with same title and same recurrence", () => {
		const tasks = [
			makeTask({
				id: "t1",
				content: "Brush teeth",
				due: { date: "2026-06-19T06:00:00", string: "every day at 6am", isRecurring: true },
			}),
			makeTask({
				id: "t2",
				content: "Brush teeth",
				due: { date: "2026-06-20T06:00:00", string: "every day at 6am", isRecurring: true },
			}),
		];
		const result = findDuplicateCandidates(tasks);
		expect(result.exactGroups).toBe(1);
	});

	it("groups non-recurring and recurring tasks with the same title as duplicates", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Brush teeth" }),
			makeTask({
				id: "t2",
				content: "Brush teeth",
				due: { date: "2026-06-19T06:00:00", string: "every day at 6am", isRecurring: true },
			}),
		];
		const result = findDuplicateCandidates(tasks);
		expect(result.exactGroups).toBe(1);
	});
});
