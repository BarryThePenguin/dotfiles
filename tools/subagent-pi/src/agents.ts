/**
 * Agent discovery and configuration (forked from pi's example subagent extension).
 *
 * The extension deliberately discovers only the approved user-level roster;
 * project-local `.pi/agents` files are not part of this surface.
 *
 * Fork changes over the example:
 *  - agents carry an optional `thinking` frontmatter field (mjakl precedent,
 *    locked by the Personas decision) so both layers can express a thinking level
 *  - the roster is surfaced to the parent model via promptSnippet/promptGuidelines
 *    (extension-fit research gap 2) — see formatRoster() in index.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const APPROVED_AGENT_NAMES = ["general", "explore"] as const;
const APPROVED_AGENT_NAME_SET = new Set<string>(APPROVED_AGENT_NAMES);

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	/** Optional thinking level (pi --thinking): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" */
	thinking?: string;
	systemPrompt: string;
	source: "user";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
}

function loadAgentsFromDir(dir: string): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) {
			continue;
		}
		if (!entry.isFile() && !entry.isSymbolicLink()) {
			continue;
		}

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } =
			parseFrontmatter<Record<string, string | undefined>>(content);

		const name = frontmatter["name"];
		const description = frontmatter["description"];
		if (!name || !description || !APPROVED_AGENT_NAME_SET.has(name)) {
			continue;
		}

		const tools = frontmatter["tools"]
			?.split(",")
			.map((t: string) => t.trim())
			.filter(Boolean);
		const model = frontmatter["model"];
		const thinking = frontmatter["thinking"];

		agents.push({
			name,
			description,
			...(tools && tools.length > 0 ? { tools } : {}),
			...(model ? { model } : {}),
			...(thinking ? { thinking } : {}),
			systemPrompt: body,
			source: "user",
			filePath,
		});
	}

	return agents;
}

/**
 * Discover the approved user-level roster.
 *
 * The cwd is deliberately not part of discovery: project-local `.pi/agents`
 * files are never executable configuration for this extension.
 */
export function discoverAgents(): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	return { agents: loadAgentsFromDir(userDir) };
}

/**
 * The fork's alias surface is a naming contract with the skills (zero skill edits):
 *  - code-review's spelling `general-purpose` → canonical `general`
 *  - improve-codebase-architecture's spelling `subagent_type=Explore` → canonical
 *    `explore` (case-insensitive)
 *  - canonical names `general` / `explore` pass through
 */
const AGENT_ALIASES: Record<string, string> = {
	"general-purpose": "general",
};

export function resolveAgentName(requested: string): string {
	const lower = requested.trim().toLowerCase();
	return AGENT_ALIASES[lower] ?? lower;
}

export function formatAgentList(
	agents: AgentConfig[],
	maxItems: number,
): { text: string; remaining: number } {
	if (agents.length === 0) {
		return { text: "none", remaining: 0 };
	}
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed
			.map((a) => `${a.name} (${a.source}): ${a.description}`)
			.join("; "),
		remaining,
	};
}
