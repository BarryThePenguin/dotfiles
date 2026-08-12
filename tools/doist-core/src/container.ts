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
import { applyRepoMarker } from "./repo-project.ts";
import { syncAndPersist, type SyncAndPersistResult } from "./sync.ts";
import { createClient, type TodoistClient } from "./todoist.ts";

export const ProjectRefSchema = v.object({
	id: v.string(),
	label: v.string(),
	repo: v.optional(v.boolean()),
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
	TODOIST_RC_DIR: v.optional(v.string(), cwd()),
});

const parseEnv = v.safeParser(EnvSchema);

function resolveRcDir(rcDir?: string): string {
	return rcDir ?? process.env["TODOIST_RC_DIR"] ?? cwd();
}

function findRcPaths(dir: string) {
	return findPaths(dir, { exists: existsSync });
}

/**
 * Raw persistence access: the database and the Todoist API client.
 *
 * Kept separate from Container so that code which only needs configuration
 * (project list, paths) does not incidentally gain access to the database or
 * the API token. Callers that genuinely need both surfaces use
 * `OperationalContainer`.
 */
export interface PersistenceLayer {
	readonly db: Database;
	readonly client: TodoistClient;
}

/**
 * Container manages configuration and lifecycle without exposing persistence.
 */
export interface Container {
	readonly paths: ConfigPaths | null;

	addProject: (ref: ProjectRef) => void;
	removeProject: (id: string) => void;
	listProjects: () => ProjectRef[];
	listProjectIds: () => string[];
	projectCount: () => number;
	setRepoProject: (id: string) => void;

	/** Sync Todoist data into the local database. */
	sync(
		projectIds: string[],
		forceFullSync?: boolean,
	): Promise<SyncAndPersistResult>;

	close(): void;
}

/**
 * The full operational type: config + lifecycle + persistence access.
 *
 * Use this type at call sites that need to read from the database or write via
 * the Todoist API. `createContainer()` always returns this type.
 */
export type OperationalContainer = Container & PersistenceLayer;

/**
 * Create a production container with real dependencies.
 *
 * @param rcDir Optional directory to start the `.doistrc` search from;
 *   defaults to `TODOIST_RC_DIR` or the process cwd
 * @returns A fully initialized container
 *
 * @throws If Database initialization fails or paths cannot be resolved
 *
 * Example:
 * ```ts
 * const container = createContainer();
 * try {
 *   await runCli(container);
 * } finally {
 *   container.close();
 * }
 * ```
 */
export function createContainer(rcDir?: string): OperationalContainer {
	const env = parseEnv(process.env);
	const dir = resolveRcDir(rcDir);
	let paths = findRcPaths(dir);
	let client: TodoistClient | null = null;
	let db: Database | null = null;

	// Create projects namespace with in-memory caching.
	// Cache is invalidated only on add/remove (mutations we control).
	let cachedProjects: ProjectRef[] | null = null;

	function getPaths(): ConfigPaths | null {
		return (paths ??= findRcPaths(dir));
	}

	function getRcPath(): string {
		return getPaths()?.rcPath ?? join(dir, ".doistrc");
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

	function setRepoProject(id: string) {
		const current = listProjects();
		const next = applyRepoMarker(current, id);
		if (next.some((project, index) => project !== current[index])) {
			cachedProjects = next;
			writeConfig({ projects: next });
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

	function getClient(): TodoistClient {
		if (!env.success) {
			throw new v.ValiError(env.issues);
		}
		if (client === null) {
			client = createClient(env.output.TODOIST_API_TOKEN);
		}
		return client;
	}

	return {
		addProject,
		listProjectIds,
		listProjects,
		projectCount,
		removeProject,
		setRepoProject,
		get paths() {
			return getPaths();
		},
		get db() {
			return getDb();
		},
		get client(): TodoistClient {
			return getClient();
		},
		sync(projectIds: string[], forceFullSync?: boolean) {
			return syncAndPersist(
				getDb(),
				getClient(),
				projectIds,
				forceFullSync ?? false,
			);
		},
		close() {
			if (db) {
				db.close();
				db = null;
			}
		},
	};
}

/**
 * Returns true when the repo at `rcDir` has a `.doistrc` with at least one
 * configured project. Reads only the config file — does not open the database
 * or validate the API token.
 */
export function hasProjects(rcDir?: string): boolean {
	try {
		const dir = resolveRcDir(rcDir);
		const paths = findRcPaths(dir);
		if (!paths) {
			return false;
		}
		const config = parseConfigSchema(readFileSync(paths.rcPath, "utf-8"));
		return config.projects.length > 0;
	} catch {
		return false;
	}
}
