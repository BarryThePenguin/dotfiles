import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationalContainer } from "doist-core";
import * as list from "./project-list.ts";

function fakeContainer(overrides: Partial<OperationalContainer> = {}) {
	return {
		paths: null,
		addProject: vi.fn(),
		removeProject: vi.fn(),
		listProjects: vi.fn().mockReturnValue([]),
		listProjectIds: vi.fn().mockReturnValue([]),
		projectCount: vi.fn().mockReturnValue(0),
		setRepoProject: vi.fn(),
		sync: vi.fn().mockResolvedValue({ ok: true }),
		close: vi.fn(),
		...overrides,
	} as unknown as OperationalContainer;
}

describe("projects list", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls listProjects() and writes the result when sync is false", async () => {
		const projects = [
			{ id: "p1", label: "Work", repo: false },
			{ id: "p2", label: "Personal", repo: true },
		];
		const container = fakeContainer({
			listProjects: vi.fn().mockReturnValue(projects),
		});

		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		const cmd = list.buildCommand(container);
		await cmd.run?.({ rawArgs: [], args: { _: [], sync: false }, cmd });

		expect(container.listProjects).toHaveBeenCalledOnce();
		expect(writeSpy).toHaveBeenCalledWith(JSON.stringify(projects) + "\n");
	});

	it("does not call sync() when sync arg is false", async () => {
		const container = fakeContainer();

		vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		const cmd = list.buildCommand(container);
		await cmd.run?.({ rawArgs: [], args: { _: [], sync: false }, cmd });

		expect(container.sync).not.toHaveBeenCalled();
	});
});
