/**
 * Container manages the lifecycle of core dependencies.
 *
 * Provides a single initialization point for both CLI and MCP,
 * centralizing bootstrap logic and enabling testable entry points.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { driverFactory } from "sqlite-runtime";
import * as v from "valibot";
import { Database } from "./db.ts";
import { createQueries, type Queries } from "./queries.ts";
import { applyRepoMarker } from "./repo-project.ts";
import { syncAndPersist, type SyncAndPersistResult } from "./sync.ts";
import { createClient, type TodoistClient } from "./todoist.ts";

export interface ConfigPaths {
	rcPath: string;
}

/**
 * Well-known user-level database location shared by every repo.
 *
 * The store lives under `$XDG_CACHE_HOME/doist/todoist.db` (defaulting to
 * `~/.cache/doist/todoist.db`) because it is a rebuildable mirror of Todoist
 * server state — a full sync can regenerate it from scratch. All consumers
 * open this single store; repo `.doistrc` files remain read-time lenses over
 * it. Tests redirect it by pointing `XDG_CACHE_HOME` at a scratch directory.
 */
export function centralDbPath(
	options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): string {
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	const xdgCacheHome = env["XDG_CACHE_HOME"];
	// XDG spec: non-absolute values must be ignored.
	const cacheHome =
		xdgCacheHome && xdgCacheHome.startsWith("/")
			? xdgCacheHome
			: join(home, ".cache");
	return join(cacheHome, "doist", "todoist.db");
}

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

/**
 * Every environment variable doist-core reads, declared in one place.
 *
 * All fields are optional here so configuration-only entry points like
 * `hasProjects()` work without an API token; `getClient()` enforces the
 * token itself. Defaults are deliberately absent — path fallbacks live in
 * the functions that consume these values (`centralDbPath`, rc-dir
 * resolution), not in the schema.
 */
const EnvSchema = v.object({
	TODOIST_API_TOKEN: v.optional(v.string()),
	TODOIST_RC_DIR: v.optional(v.string()),
	XDG_CACHE_HOME: v.optional(v.string()),
});

const parseEnv = v.parser(EnvSchema);

type Env = v.InferOutput<typeof EnvSchema>;

function resolveRcDir(rcDir: string | undefined, env: Env): string {
	return rcDir ?? env.TODOIST_RC_DIR ?? cwd();
}

/**
 * Locate the `.doistrc` for the repo containing `dir`, walking up until a
 * `.git` directory stops the search.
 */
function findRcPaths(dir: string): ConfigPaths | null {
	let current = dir;
	for (;;) {
		if (existsSync(join(current, ".doistrc"))) {
			return { rcPath: join(current, ".doistrc") };
		}
		if (existsSync(join(current, ".git"))) {
			return null;
		}
		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

/**
 * Raw persistence access: the database and the Todoist API client.
 *
 * This is the escape hatch for code that needs full `Database` CRUD —
 * `operations.ts` (writes) and `issue-tools-core`'s Wayfinder Todoist
 * adapter (task+notes reads and writes `Queries` doesn't cover), both via
 * the dedicated `doist-core/db` subpath. `RootContainer` (below)
 * structurally satisfies this; nothing built from `toOperationalContainer`
 * does.
 */
export interface PersistenceLayer {
	readonly db: Database;
	readonly client: TodoistClient;
}

/**
 * The read seam into doist-core's shared store — see `Queries` in
 * `queries.ts`. What CLI/MCP command files actually use to read
 * tasks/projects/labels/sync state; they never need the full
 * `PersistenceLayer`.
 */
export interface QueryLayer {
	readonly queries: Queries;
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
 * Config + lifecycle + the read seam + the Todoist API client — everything
 * downstream of a composition root needs, and no more. `client` stays here
 * (rather than being narrowed away too) because it has real direct
 * consumers below construction time: `doist-mcp`'s `projects.ts` and
 * `session.ts` fetch live Todoist data the local mirror doesn't serve.
 * `db` does not: every CLI/MCP read call site goes through `queries`.
 */
export type OperationalContainer = Container & QueryLayer & {
	readonly client: TodoistClient;
};

/**
 * The full type `createContainer()` returns: everything in
 * `OperationalContainer` plus the raw `db`.
 *
 * Only the handful of composition roots (`doist-cli/cli.ts`,
 * `doist-mcp/server.ts`, `issue-tools-core/todoist-tracker-factory.ts`) hold
 * this type — just long enough to build `operations`/`TodoistAdapter`, which
 * need `db`. Everything else is handed the narrower `OperationalContainer`
 * via `toOperationalContainer`.
 */
export type RootContainer = OperationalContainer & { readonly db: Database };

/**
 * Narrow a `RootContainer` to the `OperationalContainer` shape for handing
 * downstream, so `db` cannot follow it by accident.
 */
export function toOperationalContainer(
	container: RootContainer,
): OperationalContainer {
	return container;
}

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
export function createContainer(rcDir?: string): RootContainer {
	const env = parseEnv(process.env);
	const dir = resolveRcDir(rcDir, env);
	let paths: ConfigPaths | null = findRcPaths(dir);
	let client: TodoistClient | null = null;
	let db: Database | null = null;
	let dbPath: string | null = null;
	let queries: Queries | null = null;

	// Resolved lazily so that flows which create `.doistrc` after container
	// creation (e.g. `projects add` in a fresh repo) are still picked up.
	function getPaths(): ConfigPaths | null {
		return (paths ??= findRcPaths(dir));
	}

	function getRcPath(): string {
		return getPaths()?.rcPath ?? join(dir, ".doistrc");
	}

	function resolveDbPath(): string {
		return (dbPath ??= centralDbPath({ env }));
	}

	function getDb() {
		if (!getPaths()) {
			throw new Error("no .doistrc found in this git repository");
		}

		// The database is a single user-level store shared by every repo; the
		// repo `.doistrc` is only a read-time lens over it.
		if (!db) {
			dbPath = resolveDbPath();
			mkdirSync(dirname(dbPath), { recursive: true });
			db = new Database({ driver: driverFactory(dbPath) });
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
		// Write-then-rename so a crash mid-write cannot leave a truncated
		// .doistrc behind.
		const rcPath = getRcPath();
		const tmpPath = `${rcPath}.tmp`;
		writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8");
		renameSync(tmpPath, rcPath);
	}

	function addProject(ref: ProjectRef) {
		const current = listProjects();
		if (!current.some((p) => p.id === ref.id)) {
			writeConfig({ projects: [...current, ref] });
		}
	}

	function removeProject(id: string) {
		const current = listProjects();
		const filtered = current.filter((p) => p.id !== id);
		if (filtered.length !== current.length) {
			writeConfig({ projects: filtered });
		}
	}

	function setRepoProject(id: string) {
		const current = listProjects();
		const next = applyRepoMarker(current, id);
		if (next.some((project, index) => project !== current[index])) {
			writeConfig({ projects: next });
		}
	}

	function listProjects(): ProjectRef[] {
		return readConfig().projects;
	}

	function listProjectIds(): string[] {
		return listProjects().map((p) => p.id);
	}

	function projectCount(): number {
		return listProjects().length;
	}

	function getClient(): TodoistClient {
		if (env.TODOIST_API_TOKEN === undefined) {
			throw new Error(
				"Cannot create Todoist client: TODOIST_API_TOKEN is not set",
			);
		}

		if (client === null) {
			client = createClient(env.TODOIST_API_TOKEN);
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
		get queries(): Queries {
			return (queries ??= createQueries(getDb(), listProjectIds));
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
		const env = parseEnv(process.env);
		const dir = resolveRcDir(rcDir, env);
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
