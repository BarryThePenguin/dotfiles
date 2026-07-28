import { describe, expect, it } from "vitest";
import {
	addFogItem,
	addOutOfScope,
	appendDecision,
	buildInitialMapBody,
	buildMapBody,
	countSectionItems,
	listFogItems,
	type MapSections,
	parseMapBody,
	removeFogItem,
	replaceSection,
} from "./map-body.ts";

// ---------------------------------------------------------------------------
// buildInitialMapBody
// ---------------------------------------------------------------------------

describe("buildInitialMapBody", () => {
	it("creates a map with destination and empty sections", () => {
		const body = buildInitialMapBody("Ship the feature", "Notes here");

		expect(body).toContain("## destination");
		expect(body).toContain("Ship the feature");
		expect(body).toContain("## notes");
		expect(body).toContain("Notes here");
		expect(body).toContain("## decisions so far");
		expect(body).toContain("## not yet specified");
		expect(body).toContain("## out of scope");
	});

	it("defaults notes to empty", () => {
		const body = buildInitialMapBody("Goal");

		expect(body).toContain("## notes\n\n");
	});
});

// ---------------------------------------------------------------------------
// parseMapBody
// ---------------------------------------------------------------------------

describe("parseMapBody", () => {
	it("extracts all five sections", () => {
		const body = [
			"## destination",
			"",
			"Build auth",
			"",
			"## notes",
			"",
			"Use OAuth",
			"",
			"## decisions so far",
			"",
			"We chose JWT",
			"",
			"## not yet specified",
			"",
			"Token refresh",
			"",
			"## out of scope",
			"",
			"MFA",
		].join("\n");

		const sections = parseMapBody(body);

		expect(sections.destination).toBe("Build auth");
		expect(sections.notes).toBe("Use OAuth");
		expect(sections.decisions).toBe("We chose JWT");
		expect(sections.notYetSpecified).toBe("Token refresh");
		expect(sections.outOfScope).toBe("MFA");
	});

	it("handles empty sections", () => {
		const body = buildInitialMapBody("Goal");
		const sections = parseMapBody(body);

		expect(sections.destination).toBe("Goal");
		expect(sections.notes).toBe("");
		expect(sections.decisions).toBe("");
		expect(sections.notYetSpecified).toBe("");
		expect(sections.outOfScope).toBe("");
	});

	it("round-trips through build and parse", () => {
		const original: MapSections = {
			destination: "Ship it",
			notes: "Be careful",
			decisions: "- First decision",
			notYetSpecified: "- Fog item",
			outOfScope: "- MFA",
		};

		const body = buildMapBody(original);
		const parsed = parseMapBody(body);

		expect(parsed.destination).toBe(original.destination);
		expect(parsed.notes).toBe(original.notes);
		// remark-stringify uses * for lists, so normalize
		const norm = (s: string) => s.replace(/^\*/gm, "-");
		expect(norm(parsed.decisions)).toBe(norm(original.decisions));
		expect(norm(parsed.notYetSpecified)).toBe(norm(original.notYetSpecified));
		expect(norm(parsed.outOfScope)).toBe(norm(original.outOfScope));
	});
});

// ---------------------------------------------------------------------------
// appendDecision
// ---------------------------------------------------------------------------

describe("appendDecision", () => {
	it("adds a decision entry to the decisions section", () => {
		const body = buildInitialMapBody("Goal");
		const updated = appendDecision(
			body,
			"Ticket A",
			"https://todoist.com/1",
			"Chose JWT",
		);

		expect(updated).toContain("Ticket A");
		expect(updated).toContain("Chose JWT");
		expect(updated).toContain("https://todoist.com/1");
	});

	it("preserves existing decisions", () => {
		let body = buildInitialMapBody("Goal");
		body = appendDecision(body, "Ticket A", "https://a", "First");
		body = appendDecision(body, "Ticket B", "https://b", "Second");

		expect(body).toContain("First");
		expect(body).toContain("Second");
	});

	it("preserves other sections", () => {
		const body = buildInitialMapBody("Goal", "Notes");
		const updated = appendDecision(body, "Ticket A", "https://a", "Gist");

		expect(updated).toContain("Goal");
		expect(updated).toContain("Notes");
	});
});

// ---------------------------------------------------------------------------
// replaceSection
// ---------------------------------------------------------------------------

describe("replaceSection", () => {
	it("replaces content of a named section", () => {
		const body = buildInitialMapBody("Goal", "Old notes");
		const updated = replaceSection(body, "notes", "New notes here");

		expect(updated).toContain("New notes here");
		expect(updated).not.toContain("Old notes");
		expect(updated).toContain("Goal");
	});

	it("handles case-insensitive section names", () => {
		const body = buildInitialMapBody("Goal");
		const updated = replaceSection(body, "NOTES", "Lowercase match");

		expect(updated).toContain("Lowercase match");
	});
});

// ---------------------------------------------------------------------------
// Fog of war
// ---------------------------------------------------------------------------

describe("addFogItem", () => {
	it("adds a list item to the not yet specified section", () => {
		const body = buildInitialMapBody("Goal");
		const updated = addFogItem(body, "Something unclear");

		expect(updated).toContain("Something unclear");
		expect(listFogItems(updated)).toContain("Something unclear");
	});

	it("accumulates multiple items", () => {
		let body = buildInitialMapBody("Goal");
		body = addFogItem(body, "Item 1");
		body = addFogItem(body, "Item 2");

		const items = listFogItems(body);
		expect(items).toEqual(["Item 1", "Item 2"]);
	});
});

describe("removeFogItem", () => {
	it("removes an item by index", () => {
		let body = buildInitialMapBody("Goal");
		body = addFogItem(body, "Keep");
		body = addFogItem(body, "Remove");
		body = addFogItem(body, "Keep too");

		const updated = removeFogItem(body, 1);
		const items = listFogItems(updated);

		expect(items).toEqual(["Keep", "Keep too"]);
	});

	it("handles removing the only item", () => {
		let body = buildInitialMapBody("Goal");
		body = addFogItem(body, "Only item");

		const updated = removeFogItem(body, 0);
		const items = listFogItems(updated);

		expect(items).toEqual([]);
	});

	it("is a no-op for out-of-bounds index", () => {
		let body = buildInitialMapBody("Goal");
		body = addFogItem(body, "Item 1");

		const updated = removeFogItem(body, 99);
		const items = listFogItems(updated);

		expect(items).toEqual(["Item 1"]);
	});

	it("preserves prose between list items", () => {
		const body = [
			"## destination",
			"",
			"Goal",
			"",
			"## not yet specified",
			"",
			"- First",
			"",
			"Some prose we want to keep.",
			"",
			"- Third",
		].join("\n");

		const updated = removeFogItem(body, 0);
		const items = listFogItems(updated);

		expect(items).toEqual(["Third"]);
		expect(updated).toContain("Some prose we want to keep.");
	});
});

describe("listFogItems", () => {
	it("returns empty array when no fog items", () => {
		const body = buildInitialMapBody("Goal");
		expect(listFogItems(body)).toEqual([]);
	});

	it("returns items as strings", () => {
		let body = buildInitialMapBody("Goal");
		body = addFogItem(body, "First");
		body = addFogItem(body, "Second");

		expect(listFogItems(body)).toEqual(["First", "Second"]);
	});
});

// ---------------------------------------------------------------------------
// Out of scope
// ---------------------------------------------------------------------------

describe("addOutOfScope", () => {
	it("adds an item to the out of scope section", () => {
		const body = buildInitialMapBody("Goal");
		const updated = addOutOfScope(body, "MFA is out of scope");

		expect(updated).toContain("MFA is out of scope");
	});

	it("includes link when ticketUrl provided", () => {
		const body = buildInitialMapBody("Goal");
		const updated = addOutOfScope(body, "MFA", "https://todoist.com/99");

		expect(updated).toContain("MFA");
		expect(updated).toContain("https://todoist.com/99");
	});
});

// ---------------------------------------------------------------------------
// countSectionItems
// ---------------------------------------------------------------------------

describe("countSectionItems", () => {
	it("counts list items in a section", () => {
		let body = buildInitialMapBody("Goal");
		body = addFogItem(body, "A");
		body = addFogItem(body, "B");
		body = addFogItem(body, "C");

		expect(countSectionItems(body, "notYetSpecified")).toBe(3);
	});

	it("returns 0 for empty section", () => {
		const body = buildInitialMapBody("Goal");
		expect(countSectionItems(body, "notYetSpecified")).toBe(0);
	});

	it("counts nested sub-bullets", () => {
		const body = [
			"## destination",
			"",
			"Goal",
			"",
			"## not yet specified",
			"",
			"- Top",
			"  - Nested A",
			"  - Nested B",
			"- Another top",
		].join("\n");

		expect(countSectionItems(body, "notYetSpecified")).toBe(4);
	});
});
