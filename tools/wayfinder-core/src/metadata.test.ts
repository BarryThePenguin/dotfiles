import { describe, expect, it } from "vitest";
import {
	appendMetadata,
	getMetadata,
	removeMetadata,
	setMetadata,
} from "./metadata.ts";

describe("Wayfinder Markdown metadata", () => {
	it("reads hidden Wayfinder metadata comments", () => {
		const markdown = `## Question

Choose a tracker.

<!-- wayfinder:map map-123 -->
<!-- wayfinder:blocked-by ticket-1 -->
<!-- wayfinder:blocked-by ticket-2 -->
`;

		expect(getMetadata(markdown, "map")).toEqual(["map-123"]);
		expect(getMetadata(markdown, "blocked-by")).toEqual([
			"ticket-1",
			"ticket-2",
		]);
	});

	it("appends repeatable metadata without changing normal Markdown content", () => {
		const markdown = "## Question\n\nChoose a tracker.\n";

		const updated = appendMetadata(markdown, "blocked-by", "ticket-1");

		expect(updated).toContain("## Question");
		expect(updated).toContain("Choose a tracker.");
		expect(getMetadata(updated, "blocked-by")).toEqual(["ticket-1"]);
	});

	it("sets singular metadata by replacing existing values", () => {
		const markdown = `## Question

Choose a tracker.

<!-- wayfinder:claimed-by old-agent -->
`;

		const updated = setMetadata(markdown, "claimed-by", ["new-agent"]);

		expect(getMetadata(updated, "claimed-by")).toEqual(["new-agent"]);
		expect(updated).not.toContain("old-agent");
	});

	it("removes metadata without removing normal Markdown", () => {
		const markdown = `## Question

Choose a tracker.

<!-- wayfinder:claimed-by agent-1 -->
`;

		const updated = removeMetadata(markdown, "claimed-by");

		expect(getMetadata(updated, "claimed-by")).toEqual([]);
		expect(updated).toContain("Choose a tracker.");
	});
});
