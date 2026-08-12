import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentName } from "./agents.ts";
import {
	effectiveSpawnConfig,
	findNearestPersonasFile,
	loadPersonaOverrides,
} from "./personas.ts";

const tmpDirs: string[] = [];
function makeRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "subagent-pi-test-"));
	tmpDirs.push(dir);
	return dir;
}

function cleanup() {
	for (const dir of tmpDirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
}

afterEach(cleanup);

describe("resolveAgentName (alias surface)", () => {
	it("passes canonical names through", () => {
		expect(resolveAgentName("general")).toBe("general");
		expect(resolveAgentName("explore")).toBe("explore");
	});

	it("maps code-review's general-purpose spelling to general", () => {
		expect(resolveAgentName("general-purpose")).toBe("general");
	});

	it("maps improve-codebase-architecture's Explore spelling case-insensitively", () => {
		expect(resolveAgentName("Explore")).toBe("explore");
		expect(resolveAgentName("EXPLORE")).toBe("explore");
	});

	it("normalizes unknown names to lowercase", () => {
		expect(resolveAgentName("  Planner ")).toBe("planner");
	});
});

describe("personas.json override layer", () => {
	it("finds the nearest .pi/personas.json walking up from a nested cwd", () => {
		const repo = makeRepo();
		const piDir = join(repo, ".pi");
		mkdirSync(piDir);
		writeFileSync(join(piDir, "personas.json"), "{}");
		mkdirSync(join(repo, "packages", "foo"), { recursive: true });

		expect(findNearestPersonasFile(join(repo, "packages", "foo"))).toBe(
			join(piDir, "personas.json"),
		);
		expect(findNearestPersonasFile(repo)).toBe(join(piDir, "personas.json"));
	});

	it("returns null when no personas.json exists up the tree", () => {
		const repo = makeRepo();
		expect(findNearestPersonasFile(repo)).toBeNull();
	});

	it("resolves alias keys to canonical names", () => {
		const repo = makeRepo();
		const piDir = join(repo, ".pi");
		mkdirSync(piDir);
		writeFileSync(
			join(piDir, "personas.json"),
			JSON.stringify({
				"general-purpose": { provider: "gpt", model: "gpt-5.5" },
			}),
		);

		const overrides = loadPersonaOverrides(repo);
		expect(overrides.get("general")).toEqual({
			provider: "gpt",
			model: "gpt-5.5",
		});
		expect(overrides.has("general-purpose")).toBe(false);
	});

	it("ignores malformed JSON", () => {
		const repo = makeRepo();
		const piDir = join(repo, ".pi");
		mkdirSync(piDir);
		writeFileSync(join(piDir, "personas.json"), "not json{");

		expect(loadPersonaOverrides(repo).size).toBe(0);
	});
});

describe("effectiveSpawnConfig (frontmatter merged under override)", () => {
	const agent = { name: "general", model: "deepseek-v4-pro", thinking: "high" };

	it("returns frontmatter when no override", () => {
		const config = effectiveSpawnConfig(agent, new Map(), "opencode-go");
		expect(config).toEqual({
			provider: "opencode-go",
			model: "deepseek-v4-pro",
			thinking: "high",
		});
	});

	it("falls back to parent provider when neither layer pins one", () => {
		const config = effectiveSpawnConfig(
			{ name: "general", model: "x" },
			new Map(),
		);
		expect(config.provider).toBeUndefined();
	});

	it("override wins per-field over frontmatter", () => {
		const overrides = new Map([
			["general", { provider: "gpt", model: "gpt-5.5", thinkingLevel: "low" }],
		]);
		const config = effectiveSpawnConfig(agent, overrides, "opencode-go");
		expect(config).toEqual({
			provider: "gpt",
			model: "gpt-5.5",
			thinking: "low",
		});
	});

	it("override model does not leak to a different agent", () => {
		const overrides = new Map([["general", { model: "gpt-5.5" }]]);
		const config = effectiveSpawnConfig(
			{ name: "explore", model: "deepseek-v4-flash" },
			overrides,
		);
		expect(config.model).toBe("deepseek-v4-flash");
	});

	it("carries an explicit quota fallback into the effective config", () => {
		const overrides = new Map([
			[
				"explore",
				{
					model: "deepseek-v4-flash",
					quotaFallback: { provider: "opencode", model: "big-pickle" },
				},
			],
		]);
		const config = effectiveSpawnConfig(
			{ name: "explore", model: "deepseek-v4-flash" },
			overrides,
		);
		expect(config.fallback).toEqual({
			provider: "opencode",
			model: "big-pickle",
		});
	});
});
