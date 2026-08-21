import { describe, expect, it } from "vitest";
import {
	runTodoistSetup,
	type TodoistSetupContainer,
} from "./setup-workflow.ts";

type FakeContainer = TodoistSetupContainer & { markedRepo: string | null };

function fakeContainer(ids: string[]): FakeContainer {
	let markedRepo: string | null = null;
	return {
		listProjects: () => ids.map((id) => ({ id, label: id, repo: false })),
		setRepoProject: (id) => {
			markedRepo = id;
		},
		get markedRepo() {
			return markedRepo;
		},
	};
}

describe("runTodoistSetup", () => {
	it("returns no-projects when container has no projects", async () => {
		const outcome = await runTodoistSetup({
			container: fakeContainer([]),
			selectProject: () => undefined,
		});
		expect(outcome).toEqual({ status: "no-projects" });
	});

	it("returns cancelled when selectProject returns undefined", async () => {
		const outcome = await runTodoistSetup({
			container: fakeContainer(["p1", "p2"]),
			selectProject: () => undefined,
		});
		expect(outcome).toEqual({ status: "cancelled" });
	});

	it("returns not-found with available IDs when an unknown ID is selected", async () => {
		const outcome = await runTodoistSetup({
			container: fakeContainer(["p1", "p2"]),
			selectProject: () => "unknown",
		});
		expect(outcome).toEqual({ status: "not-found", available: ["p1", "p2"] });
	});

	it("returns success and marks the project when a valid ID is selected", async () => {
		const container = fakeContainer(["p1", "p2"]);
		const outcome = await runTodoistSetup({
			container,
			selectProject: () => "p1",
		});
		expect(outcome).toEqual({ status: "success", projectId: "p1" });
		expect(container.markedRepo).toBe("p1");
	});

	it("passes projects list to selectProject", async () => {
		const received: string[] = [];
		await runTodoistSetup({
			container: fakeContainer(["a", "b", "c"]),
			selectProject: (projects) => {
				received.push(...projects.map((p) => p.id));
				return projects[0]?.id;
			},
		});
		expect(received).toEqual(["a", "b", "c"]);
	});
});
