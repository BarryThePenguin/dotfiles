/**
 * Project-local persona override layer (.pi/personas.json) — locked by the
 * "Personas: agents.md vs presets" decision.
 *
 * Base layer: agents.md frontmatter in dotfiles (~/.pi/agent/agents) is identity —
 * name, description, tools, systemPrompt are NOT overridable.
 * Override layer: project-local .pi/personas.json, keyed by canonical persona name
 * (skill aliases resolve to canonical first), schema
 * `{ provider?, model?, thinkingLevel? }`. Discovered by walking up from cwd to the
 * nearest file (pi's findNearestProjectAgentsDir pattern), so nested invocations
 * (work/repo/packages/foo) still resolve the repo root's file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { resolveAgentName } from "./agents.ts";

export interface PersonaFallback {
	provider?: string;
	model?: string;
}

export interface PersonaOverride {
	provider?: string;
	model?: string;
	thinkingLevel?: string;
	quotaFallback?: PersonaFallback;
}

/** The effective spawn config for an agent: frontmatter merged under the override layer. */
export interface EffectiveSpawnConfig {
	provider?: string;
	model?: string;
	thinking?: string;
	fallback?: PersonaFallback;
}

export function findNearestPersonasFile(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "personas.json");
		if (fs.existsSync(candidate)) {
			return candidate;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
}

export function loadPersonaOverrides(
	cwd: string,
): Map<string, PersonaOverride> {
	const map = new Map<string, PersonaOverride>();
	const file = findNearestPersonasFile(cwd);
	if (!file) {
		return map;
	}

	let parsed: Record<string, PersonaOverride>;
	try {
		parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
			string,
			PersonaOverride
		>;
	} catch {
		return map;
	}

	for (const [key, value] of Object.entries(parsed)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const canonical = resolveAgentName(key);
		const override: PersonaOverride = {};
		if (typeof value.provider === "string") {
			override.provider = value.provider;
		}
		if (typeof value.model === "string") {
			override.model = value.model;
		}
		if (typeof value.thinkingLevel === "string") {
			override.thinkingLevel = value.thinkingLevel;
		}
		if (value.quotaFallback && typeof value.quotaFallback === "object") {
			const fallback: PersonaFallback = {};
			if (typeof value.quotaFallback.provider === "string") {
				fallback.provider = value.quotaFallback.provider;
			}
			if (typeof value.quotaFallback.model === "string") {
				fallback.model = value.quotaFallback.model;
			}
			if (fallback.provider || fallback.model) {
				override.quotaFallback = fallback;
			}
		}
		map.set(canonical, override);
	}

	return map;
}

/**
 * Merge agents.md frontmatter with the override layer.
 * `parentProvider` is the parent session's provider, used as the default when
 * neither the frontmatter nor the override pins one — the child mirrors the
 * parent's provider context (work=gpt, personal=opencode-go).
 */
export function effectiveSpawnConfig(
	agent: { name: string; model?: string; thinking?: string },
	overrides: Map<string, PersonaOverride>,
	parentProvider?: string,
): EffectiveSpawnConfig {
	const o = overrides.get(agent.name);
	const provider = o?.provider ?? parentProvider;
	const model = o?.model ?? agent.model;
	const thinking = o?.thinkingLevel ?? agent.thinking;
	return {
		...(provider ? { provider } : {}),
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		...(o?.quotaFallback ? { fallback: o.quotaFallback } : {}),
	};
}
