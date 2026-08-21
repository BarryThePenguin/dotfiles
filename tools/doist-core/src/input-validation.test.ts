/**
 * Tests for the valibot input schemas in `./schemas.ts`.
 *
 * Each enforceable field is covered twice: once at exactly the limit (passes)
 * and once at limit + 1 (fails, with the error pointing at the right field
 * and a `max_length` issue whose `requirement` is the documented cap).
 *
 * The numeric limits are read from `./limits.ts` so the assertions stay
 * correct if Todoist changes a cap in the future.
 */

import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { LIMITS } from "./limits.ts";
import {
	AddCommentFieldsSchema,
	AddFilterFieldsSchema,
	AddTaskFieldsSchema,
	FilterQueryInputSchema,
	TasksUpdateInputSchema,
	UpdateFilterFieldsSchema,
	UpdateTaskFieldsSchema,
} from "./input-validation.ts";

const overByOne = (n: number) => "x".repeat(n + 1);
const atCap = (n: number) => "x".repeat(n);

describe("LIMITS", () => {
	it("exposes the documented Todoist caps", () => {
		expect(LIMITS).toEqual({
			taskName: 500,
			taskDescription: 16383,
			date: 150,
			sectionName: 2048,
			projectName: 120,
			filterName: 60,
			filterQuery: 1024,
			labelName: 60,
			taskComment: 15000,
		});
	});
});

// ── AddTaskFieldsSchema ───────────────────────────────────────────────────

describe("AddTaskFieldsSchema", () => {
	it("accepts a title at exactly the cap", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: atCap(LIMITS.taskName),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a title one over the cap, pointing at `title`", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: overByOne(LIMITS.taskName),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof AddTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.title).toContain(
			"Invalid length: Expected <=500 but received 501",
		);
	});

	it("accepts a description at exactly the cap", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: "ok",
			description: atCap(LIMITS.taskDescription),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a description one over the cap", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: "ok",
			description: overByOne(LIMITS.taskDescription),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof AddTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.description).toContain(
			"Invalid length: Expected <=16383 but received 16384",
		);
	});

	it("accepts a due string at exactly the cap", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: "ok",
			due: atCap(LIMITS.date),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a due string one over the cap", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: "ok",
			due: overByOne(LIMITS.date),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof AddTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.due).toContain(
			"Invalid length: Expected <=150 but received 151",
		);
	});

	it("rejects a label name one over the cap", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: "ok",
			labels: [atCap(LIMITS.labelName), overByOne(LIMITS.labelName)],
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof AddTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.["labels.1"]).toContain(
			"Invalid length: Expected <=60 but received 61",
		);
	});

	it("accepts label names at exactly the cap", () => {
		const result = v.safeParse(AddTaskFieldsSchema, {
			title: "ok",
			labels: [atCap(LIMITS.labelName)],
		});
		expect(result.success).toBe(true);
	});
});

// ── UpdateTaskFieldsSchema ────────────────────────────────────────────────

describe("UpdateTaskFieldsSchema", () => {
	it("rejects a title one over the cap", () => {
		const result = v.safeParse(UpdateTaskFieldsSchema, {
			title: overByOne(LIMITS.taskName),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof UpdateTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.title).toContain(
			"Invalid length: Expected <=500 but received 501",
		);
	});

	it("accepts a title at the cap", () => {
		const result = v.safeParse(UpdateTaskFieldsSchema, {
			title: atCap(LIMITS.taskName),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a description one over the cap", () => {
		const result = v.safeParse(UpdateTaskFieldsSchema, {
			description: overByOne(LIMITS.taskDescription),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof UpdateTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.description).toContain(
			"Invalid length: Expected <=16383 but received 16384",
		);
	});

	it("rejects a due string one over the cap", () => {
		const result = v.safeParse(UpdateTaskFieldsSchema, {
			due: overByOne(LIMITS.date),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof UpdateTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.due).toContain(
			"Invalid length: Expected <=150 but received 151",
		);
	});

	it("rejects an addLabels entry one over the cap", () => {
		const result = v.safeParse(UpdateTaskFieldsSchema, {
			addLabels: [overByOne(LIMITS.labelName)],
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof UpdateTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.["addLabels.0"]).toContain(
			"Invalid length: Expected <=60 but received 61",
		);
	});

	it("rejects a removeLabels entry one over the cap", () => {
		const result = v.safeParse(UpdateTaskFieldsSchema, {
			removeLabels: [overByOne(LIMITS.labelName)],
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof UpdateTaskFieldsSchema>(result.issues);
		expect(issues?.nested?.["removeLabels.0"]).toContain(
			"Invalid length: Expected <=60 but received 61",
		);
	});
});

// ── TasksUpdateInputSchema ────────────────────────────────────────────────

describe("TasksUpdateInputSchema", () => {
	it("rejects an over-cap title even when id is present", () => {
		const result = v.safeParse(TasksUpdateInputSchema, {
			id: "t1",
			title: overByOne(LIMITS.taskName),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof TasksUpdateInputSchema>(result.issues);
		expect(issues?.nested?.title).toContain(
			"Invalid length: Expected <=500 but received 501",
		);
	});
});

// ── AddFilterFieldsSchema ─────────────────────────────────────────────────

describe("AddFilterFieldsSchema", () => {
	it("accepts name and query at the cap", () => {
		const result = v.safeParse(AddFilterFieldsSchema, {
			name: atCap(LIMITS.filterName),
			query: atCap(LIMITS.filterQuery),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a name one over the cap", () => {
		const result = v.safeParse(AddFilterFieldsSchema, {
			name: overByOne(LIMITS.filterName),
			query: "ok",
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof AddFilterFieldsSchema>(result.issues);
		expect(issues?.nested?.name).toContain(
			"Invalid length: Expected <=60 but received 61",
		);
	});

	it("rejects a query one over the cap", () => {
		const result = v.safeParse(AddFilterFieldsSchema, {
			name: "ok",
			query: overByOne(LIMITS.filterQuery),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof AddFilterFieldsSchema>(result.issues);
		expect(issues?.nested?.query).toContain(
			"Invalid length: Expected <=1024 but received 1025",
		);
	});
});

// ── UpdateFilterFieldsSchema ──────────────────────────────────────────────

describe("UpdateFilterFieldsSchema", () => {
	it("rejects a name one over the cap", () => {
		const result = v.safeParse(UpdateFilterFieldsSchema, {
			name: overByOne(LIMITS.filterName),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof UpdateFilterFieldsSchema>(result.issues);
		expect(issues?.nested?.name).toContain(
			"Invalid length: Expected <=60 but received 61",
		);
	});

	it("rejects a query one over the cap", () => {
		const result = v.safeParse(UpdateFilterFieldsSchema, {
			query: overByOne(LIMITS.filterQuery),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof UpdateFilterFieldsSchema>(result.issues);
		expect(issues?.nested?.query).toContain(
			"Invalid length: Expected <=1024 but received 1025",
		);
	});

	it("accepts an empty update (no fields)", () => {
		const result = v.safeParse(UpdateFilterFieldsSchema, {});
		expect(result.success).toBe(true);
	});
});

// ── FilterQueryInputSchema ────────────────────────────────────────────────

describe("FilterQueryInputSchema", () => {
	it("accepts a query at the cap", () => {
		const result = v.safeParse(FilterQueryInputSchema, {
			query: atCap(LIMITS.filterQuery),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a query one over the cap", () => {
		const result = v.safeParse(FilterQueryInputSchema, {
			query: overByOne(LIMITS.filterQuery),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof FilterQueryInputSchema>(result.issues);
		expect(issues?.nested?.query).toContain(
			"Invalid length: Expected <=1024 but received 1025",
		);
	});
});

// ── AddCommentFieldsSchema ────────────────────────────────────────────────

describe("AddCommentFieldsSchema", () => {
	it("accepts content at the cap", () => {
		const result = v.safeParse(AddCommentFieldsSchema, {
			taskId: "t1",
			content: atCap(LIMITS.taskComment),
		});
		expect(result.success).toBe(true);
	});

	it("rejects content one over the cap", () => {
		const result = v.safeParse(AddCommentFieldsSchema, {
			taskId: "t1",
			content: overByOne(LIMITS.taskComment),
		});
		const issues = result.success
			? undefined
			: v.flatten<typeof AddCommentFieldsSchema>(result.issues);
		expect(issues?.nested?.content).toContain(
			"Invalid length: Expected <=15000 but received 15001",
		);
	});
});
