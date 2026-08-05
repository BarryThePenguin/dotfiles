import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const testPaths = vi.hoisted(() => ({ userAgentRoot: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => testPaths.userAgentRoot };
});

import { APPROVED_AGENT_NAMES, discoverAgents } from "./agents.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	testPaths.userAgentRoot = "";
});

describe("user-level agent discovery", () => {
	it("loads only the approved user-level roster", () => {
		const root = mkdtempSync(join(tmpdir(), "subagent-pi-agents-test-"));
		tempDirs.push(root);
		testPaths.userAgentRoot = root;
		const userAgentsDir = join(root, "agents");
		mkdirSync(userAgentsDir);
		writeFileSync(
			join(userAgentsDir, "general.md"),
			"---\nname: general\ndescription: General\n---\nGeneral prompt",
		);
		writeFileSync(
			join(userAgentsDir, "explore.md"),
			"---\nname: explore\ndescription: Explore\n---\nExplore prompt",
		);
		writeFileSync(
			join(userAgentsDir, "project-planner.md"),
			"---\nname: planner\ndescription: Planner\n---\nPlanner prompt",
		);
		const projectAgentsDir = join(root, ".pi", "agents");
		mkdirSync(projectAgentsDir, { recursive: true });
		writeFileSync(
			join(projectAgentsDir, "dangerous.md"),
			"---\nname: dangerous\ndescription: Dangerous\n---\nDangerous prompt",
		);

		const { agents } = discoverAgents();

		expect(agents.map((agent) => agent.name).sort()).toEqual(
			[...APPROVED_AGENT_NAMES].sort(),
		);
		expect(
			agents.every((agent) => agent.filePath.startsWith(userAgentsDir)),
		).toBe(true);
	});

	it("does not expose a project discovery surface", () => {
		expect(discoverAgents()).not.toHaveProperty("projectAgentsDir");
	});
});
