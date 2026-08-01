import { describe, expect, it } from "vitest";
import wayfinderExtension from "./index.ts";

describe("extension surface", () => {
	it("registers every wayfinder_* tool exactly once", () => {
		const tools: Record<string, number> = {};
		const api = {
			registerTool(def: { name: string }) {
				tools[def.name] = (tools[def.name] ?? 0) + 1;
			},
			on() {},
		};
		wayfinderExtension(api as never);

		const names = Object.keys(tools).sort();
		expect(names).toEqual([
			"issue_create",
			"issue_read",
			"wayfinder_chart",
			"wayfinder_claim",
			"wayfinder_create_ticket",
			"wayfinder_get_map",
			"wayfinder_get_ticket",
			"wayfinder_list_frontier",
			"wayfinder_list_maps",
			"wayfinder_resolve",
			"wayfinder_set_blocking",
			"wayfinder_update_map",
		]);
		for (const count of Object.values(tools)) {
			expect(count).toBe(1);
		}
	});
});
