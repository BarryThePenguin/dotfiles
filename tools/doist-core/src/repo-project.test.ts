import { describe, expect, it } from "vitest";
import { selectRepoProject } from "./repo-project.ts";

describe("selectRepoProject", () => {
	it("returns the project with repo: true when exactly one is marked", () => {
		expect(
			selectRepoProject([
				{ id: "p1", label: "Work" },
				{ id: "p2", label: "Personal", repo: true },
				{ id: "p3", label: "Inbox" },
			]),
		).toEqual({ id: "p2", label: "Personal", repo: true });
	});

	it("falls back to the first-listed project when no marker is present", () => {
		expect(
			selectRepoProject([
				{ id: "p1", label: "Work" },
				{ id: "p2", label: "Personal" },
			]),
		).toEqual({ id: "p1", label: "Work" });
	});

	it("returns the first-listed project when the marker is on the first one", () => {
		expect(
			selectRepoProject([
				{ id: "p1", label: "Work", repo: true },
				{ id: "p2", label: "Personal" },
			]),
		).toEqual({ id: "p1", label: "Work", repo: true });
	});

	it("returns undefined for an empty project list", () => {
		expect(selectRepoProject([])).toBeUndefined();
	});

	it("works over a shared .doistrc shape (personal projects + a repo project)", () => {
		// The dotfiles repo's actual layout: many personal-task projects
		// sharing the rc with one repo project, marked at any position.
		const projects = [
			{ id: "dotfiles", label: "Dotfiles", repo: true },
			{ id: "inbox", label: "Inbox" },
			{ id: "personal", label: "Personal" },
			{ id: "routines", label: "Routines" },
			{ id: "homelab", label: "Homelab" },
		];
		expect(selectRepoProject(projects)).toEqual({
			id: "dotfiles",
			label: "Dotfiles",
			repo: true,
		});
	});
});
