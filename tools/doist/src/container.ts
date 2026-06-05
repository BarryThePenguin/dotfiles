/**
 * Container manages the lifecycle of core dependencies.
 *
 * Provides a single initialization point for both CLI and MCP,
 * centralizing bootstrap logic and enabling testable entry points.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import * as v from "valibot";
import { Database } from "./db.ts";
import type { ConfigPaths } from "./paths.ts";
import { findPaths } from "./paths.ts";
import { createClient, type TodoistClient } from "./todoist.ts";

export const ProjectRefSchema = v.object({
	id: v.string(),
	label: v.string(),
});

export type ProjectRef = v.InferOutput<typeof ProjectRefSchema>;

const ConfigSchema = v.object({
	projects: v.array(ProjectRefSchema),
});

type Config = v.InferOutput<typeof ConfigSchema>;

const parseConfigSchema = v.parser(
	v.pipe(v.string(), v.parseJson(), ConfigSchema),
);

const EnvSchema = v.object({
	TODOIST_API_TOKEN: v.string(),
	TODOIST_RC_DIR: v.optional(v.string()),
});

const parseEnv = v.parser(EnvSchema);

/**
 * Container bundles dependencies and manages their lifecycle.
 */
export interface Container {
	readonly paths: ConfigPaths | null;
	readonly db: Database;
	readonly client: TodoistClient;

	addProject: (ref: ProjectRef) => void;
	removeProject: (id: string) => void;
	listProjects: () => ProjectRef[];
	listProjectIds: () => string[];
	projectCount: () => number;

	close(): void;
}

/**
 * Create a production container with real dependencies.
 *
 * @param apiToken Todoist API token (required; must not be empty)
 * @param config Optional overrides for filesystem paths
 * @returns A fully initialized container
 *
 * @throws If Database initialization fails or paths cannot be resolved
 *
 * Example:
 * ```ts
 * const container = createContainer(env.TODOIST_API_TOKEN);
 * try {
 *   await runCli(container);
 * } finally {
 *   container.close();
 * }
 * ```
 */
export function createContainer(): Container {
	const env = parseEnv(process.env);
	const rcDir = env.TODOIST_RC_DIR ?? cwd();
	let paths = findPaths(rcDir, { exists: existsSync });
	let db: Database | null = null;

	// Create projects namespace with in-memory caching.
	// Cache is invalidated only on add/remove (mutations we control).
	let cachedProjects: ProjectRef[] | null = null;

	function getPaths(): ConfigPaths | null {
		return paths ??= findPaths(rcDir, { exists: existsSync });
	}

	function getRcPath(): string {
		return getPaths()?.rcPath ?? join(rcDir, ".doistrc");
	}

	function getDb() {
		const paths = getPaths();
		if (paths) {
			db ??= new Database(paths);
		}

		if (!db) {
			throw new Error("no .doistrc found in this git repository");
		}

		return db;
	}

	function readConfig(): Config {
		if (existsSync(getRcPath())) {
			return parseConfigSchema(readFileSync(getRcPath(), "utf-8"));
		}

		return { projects: [] };
	}

	function writeConfig(config: Config): void {
		writeFileSync(getRcPath(), JSON.stringify(config, null, 2), "utf-8");
	}

	function addProject(ref: ProjectRef) {
		const current = listProjects();
		if (!current.some((p) => p.id === ref.id)) {
			cachedProjects = [...current, ref];
			writeConfig({ projects: cachedProjects });
		}
	}

	function removeProject(id: string) {
		const current = listProjects();
		const filtered = current.filter((p) => p.id !== id);
		if (filtered.length !== current.length) {
			cachedProjects = filtered;
			writeConfig({ projects: filtered });
		}
	}

	function listProjects(): ProjectRef[] {
		if (cachedProjects === null) {
			const { projects } = readConfig();
			cachedProjects = projects;
		}
		return cachedProjects;
	}

	function listProjectIds(): string[] {
		return listProjects().map((p) => p.id);
	}

	function projectCount(): number {
		return listProjects().length;
	}

	const client = createClient(env.TODOIST_API_TOKEN);

	return {
		addProject,
		listProjectIds,
		listProjects,
		projectCount,
		removeProject,
		get paths() {
			return getPaths();
		},
		get db() {
			return getDb();
		},
		client,
		close() {
			if (db) {
				db.close();
				db = null;
			}
		},
	};
}
