import { describe, expect, it } from "vitest";
import type { AppTask } from "../schema.ts";
import { filterByEnergy, findMissingEnergyMetadata } from "./energy.ts";

function makeTask(
	overrides: Partial<AppTask> & { id: string; content: string },
): AppTask {
	return {
		url: `https://app.todoist.com/app/task/${overrides.id}`,
		projectId: "proj-1",
		sectionId: null,
		parentId: null,
		childOrder: 0,
		noteCount: 0,
		updatedAt: "2026-01-01T00:00:00Z",
		description: null,
		priority: null,
		due: null,
		labels: [],
		isCompleted: false,
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

// ── findMissingEnergyMetadata ─────────────────────────────────────────────────

describe("findMissingEnergyMetadata", () => {
	it("returns tasks with no priority and no energy labels", () => {
		const tasks = [
			makeTask({
				id: "t1",
				content: "Unlabelled task",
				priority: null,
				labels: [],
			}),
		];
		const result = findMissingEnergyMetadata(tasks);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("t1");
	});

	it("excludes tasks with low-energy label", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Easy task", labels: ["low-energy"] }),
		];
		expect(findMissingEnergyMetadata(tasks)).toHaveLength(0);
	});

	it("excludes tasks with medium-energy label", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Medium task", labels: ["medium-energy"] }),
		];
		expect(findMissingEnergyMetadata(tasks)).toHaveLength(0);
	});

	it("excludes tasks with high-energy label", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Hard task", labels: ["high-energy"] }),
		];
		expect(findMissingEnergyMetadata(tasks)).toHaveLength(0);
	});

	it("excludes tasks with quick label", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Quick task", labels: ["quick"] }),
		];
		expect(findMissingEnergyMetadata(tasks)).toHaveLength(0);
	});

	it("excludes tasks with priority 1-3", () => {
		const tasks = [
			makeTask({ id: "t1", content: "P1 task", priority: 1 }),
			makeTask({ id: "t2", content: "P2 task", priority: 2 }),
			makeTask({ id: "t3", content: "P3 task", priority: 3 }),
		];
		expect(findMissingEnergyMetadata(tasks)).toHaveLength(0);
	});

	it("includes tasks with priority 4 (Todoist no-priority) and no energy labels", () => {
		const tasks = [
			makeTask({
				id: "t1",
				content: "No priority task",
				priority: 4,
				labels: [],
			}),
		];
		expect(findMissingEnergyMetadata(tasks)).toHaveLength(1);
	});

	it("includes tasks with priority null and no energy labels", () => {
		const tasks = [
			makeTask({
				id: "t1",
				content: "No priority task",
				priority: null,
				labels: [],
			}),
		];
		expect(findMissingEnergyMetadata(tasks)).toHaveLength(1);
	});

	it("returns only tasks missing both priority and energy labels", () => {
		const tasks = [
			makeTask({
				id: "t1",
				content: "Missing both",
				priority: null,
				labels: [],
			}),
			makeTask({
				id: "t2",
				content: "Has label",
				priority: null,
				labels: ["quick"],
			}),
			makeTask({ id: "t3", content: "Has priority", priority: 2, labels: [] }),
		];
		const result = findMissingEnergyMetadata(tasks);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("t1");
	});
});

// ── filterByEnergy ────────────────────────────────────────────────────────────

describe("filterByEnergy", () => {
	it("returns low-energy and quick tasks for low energy", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Low task", labels: ["low-energy"] }),
			makeTask({ id: "t2", content: "Quick task", labels: ["quick"] }),
			makeTask({ id: "t3", content: "Medium task", labels: ["medium-energy"] }),
			makeTask({ id: "t4", content: "High task", labels: ["high-energy"] }),
		];
		const result = filterByEnergy(tasks, "low");
		expect(result.map((t) => t.id)).toEqual(
			expect.arrayContaining(["t1", "t2"]),
		);
		expect(result.map((t) => t.id)).not.toContain("t3");
		expect(result.map((t) => t.id)).not.toContain("t4");
	});

	it("excludes high-energy tasks for medium energy", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Low task", labels: ["low-energy"] }),
			makeTask({ id: "t2", content: "Medium task", labels: ["medium-energy"] }),
			makeTask({ id: "t3", content: "Quick task", labels: ["quick"] }),
			makeTask({ id: "t4", content: "High task", labels: ["high-energy"] }),
		];
		const result = filterByEnergy(tasks, "medium");
		expect(result.map((t) => t.id)).not.toContain("t4");
		expect(result.length).toBeLessThanOrEqual(2);
	});

	it("returns empty array for high energy", () => {
		const tasks = [
			makeTask({ id: "t1", content: "Any task", labels: ["high-energy"] }),
		];
		expect(filterByEnergy(tasks, "high")).toHaveLength(0);
	});

	it("limits results to 2", () => {
		const tasks = [
			makeTask({ id: "t1", content: "A", labels: ["low-energy"] }),
			makeTask({ id: "t2", content: "B", labels: ["low-energy"] }),
			makeTask({ id: "t3", content: "C", labels: ["low-energy"] }),
		];
		expect(filterByEnergy(tasks, "low")).toHaveLength(2);
	});

	it("falls back to first 2 tasks by priority when no label matches for low", () => {
		const tasks = [
			makeTask({ id: "t1", content: "P1 task", priority: 1, labels: [] }),
			makeTask({ id: "t2", content: "P2 task", priority: 2, labels: [] }),
			makeTask({ id: "t3", content: "P3 task", priority: 3, labels: [] }),
		];
		const result = filterByEnergy(tasks, "low");
		expect(result).toHaveLength(2);
	});

	it("falls back to first 2 tasks by priority when no label matches for medium", () => {
		const tasks = [
			makeTask({ id: "t1", content: "P1 task", priority: 1, labels: [] }),
			makeTask({ id: "t2", content: "P2 task", priority: 2, labels: [] }),
		];
		const result = filterByEnergy(tasks, "medium");
		expect(result).toHaveLength(2);
	});

	it("returns empty when no tasks at all for high", () => {
		expect(filterByEnergy([], "high")).toHaveLength(0);
	});
});
