import { describe, expect, it } from "vitest";
import { createTrackerModules, type TrackerStorage } from "./modules.ts";

describe("createTrackerModules", () => {
	it("exposes separate Issue and Wayfinder interfaces over one adapter", () => {
		const storage = {
			issues: {},
			wayfinder: {},
		} as TrackerStorage;
		const modules = createTrackerModules(storage);

		expect(modules.issues).toHaveProperty("createIssue");
		expect(modules.issues).not.toHaveProperty("createMap");
		expect(modules.wayfinder).toHaveProperty("createMap");
		expect(modules.wayfinder).not.toHaveProperty("createIssue");
	});
});
