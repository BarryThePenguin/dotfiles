import { describe, expect, it } from "vitest";
import {
	TODOIST_TICKET_TYPE_LABELS,
	WAYFINDER_MAP_LABEL,
	ticketTypeToTodoistLabel,
	todoistLabelToTicketType,
} from "./labels.ts";

describe("Todoist Wayfinder labels", () => {
	it("maps canonical ticket types to Todoist-safe labels", () => {
		expect(WAYFINDER_MAP_LABEL).toBe("wayfinder_map");
		expect(TODOIST_TICKET_TYPE_LABELS).toEqual({
			research: "wayfinder_research",
			prototype: "wayfinder_prototype",
			grilling: "wayfinder_grilling",
			task: "wayfinder_task",
		});
		expect(ticketTypeToTodoistLabel("research")).toBe("wayfinder_research");
	});

	it("maps Todoist labels back to canonical ticket types", () => {
		expect(todoistLabelToTicketType("wayfinder_task")).toBe("task");
		expect(todoistLabelToTicketType("unrelated")).toBeUndefined();
	});
});
