import { describe, expect, it } from "vitest";
import { unwrapComments } from "./doist-cli-gateway.ts";

describe("unwrapComments", () => {
	it("unwraps doist-core operation results from comments list output", () => {
		const output = JSON.stringify({
			ok: true,
			result: [{ content: "Resolution: use generic issue tools." }],
		});

		expect(unwrapComments(output)).toEqual([
			{ content: "Resolution: use generic issue tools." },
		]);
	});

	it("still accepts a bare comments array", () => {
		const output = JSON.stringify([{ content: "Legacy shape" }]);

		expect(unwrapComments(output)).toEqual([{ content: "Legacy shape" }]);
	});
});
