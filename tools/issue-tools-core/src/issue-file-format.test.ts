import { describe, expect, it } from "vitest";
import {
	issueFileBodyFromMarkdown,
	issueMarkdown,
} from "./issue-file-format.ts";

describe("issueFileBodyFromDocument / issueMarkdown", () => {
	it("renders a title, body, labels Status line, and Comments section", () => {
		const markdown = issueMarkdown({
			title: "Add a generic issue surface",
			body: "Spec is at /path/to/spec.md.",
			labels: ["needs-triage", "bug"],
			status: "open",
			comments: [
				{ content: "First agent comment" },
				{ content: "Second agent comment" },
			],
		});

		expect(markdown).toContain("# Add a generic issue surface");
		expect(markdown).toContain("Status: needs-triage, bug");
		expect(markdown).toContain("Spec is at /path/to/spec.md.");
		expect(markdown).toContain("## Comments");
		expect(markdown).toContain("> First agent comment");
		expect(markdown).toContain("> Second agent comment");
	});

	it("omits the Status line when there are no labels (unlabeled)", () => {
		const markdown = issueMarkdown({
			title: "Untracked question",
			body: "Body.",
			labels: [],
			status: "open",
		});

		expect(markdown).not.toMatch(/^Status:/m);
	});

	it("includes a Closed line when the status is closed", () => {
		const markdown = issueMarkdown({
			title: "Resolved",
			body: "Body.",
			labels: ["wontfix"],
			status: "closed",
			updatedAt: "2026-01-15T12:00:00.000Z",
		});

		expect(markdown).toContain("Status: wontfix");
		expect(markdown).toContain("Closed: 2026-01-15T12:00:00.000Z");
	});

	it("renders an Answer section for the resolution comment", () => {
		const markdown = issueMarkdown({
			title: "Resolved",
			body: "Body.",
			labels: [],
			status: "open",
			answer: "Resolution: use Todoist",
		});

		expect(markdown).toContain("## Answer");
		expect(markdown).toContain("Resolution: use Todoist");
	});

	it("round-trips through issueFileBodyFromMarkdown", () => {
		const original = {
			title: "Add a generic issue surface",
			body: "Spec is at /path/to/spec.md.\n\nMore body.",
			labels: ["needs-triage", "bug"],
			status: "open" as const,
			comments: [
				{ content: "First agent comment" },
				{ content: "Second agent comment" },
			],
			answer: "Resolution: use Todoist",
		};
		const markdown = issueMarkdown({
			...original,
			comments: original.comments,
		});
		const parsed = issueFileBodyFromMarkdown(markdown);

		expect(parsed).toEqual({
			title: original.title,
			body: original.body,
			labels: original.labels,
			status: "open",
			comments: original.comments.map((c) => c.content),
			answer: original.answer,
		});
	});

	it("treats a file with no Status line as unlabeled", () => {
		const markdown = issueMarkdown({
			title: "Untracked",
			body: "Body.",
			labels: [],
			status: "open",
		});

		const parsed = issueFileBodyFromMarkdown(markdown);
		expect(parsed.labels).toEqual([]);
		expect(parsed.status).toBe("open");
	});

	it("reads a file with a Closed line as closed", () => {
		const markdown = issueMarkdown({
			title: "Closed issue",
			body: "Body.",
			labels: ["wontfix"],
			status: "closed",
			updatedAt: "2026-02-01T10:00:00.000Z",
		});

		const parsed = issueFileBodyFromMarkdown(markdown);
		expect(parsed.status).toBe("closed");
		expect(parsed.labels).toEqual(["wontfix"]);
		expect(parsed.updatedAt).toBe("2026-02-01T10:00:00.000Z");
	});
});
