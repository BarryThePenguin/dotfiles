/**
 * Test utilities for creating containers with mock dependencies.
 *
 * Use createTestContainer in unit tests to avoid real HTTP calls, file I/O,
 * and database initialization overhead.
 */

import { vi, type Mocked } from "vitest";
import type { ProjectRef } from "../container.ts";
import { Database } from "../db.ts";
import { type ConfigPaths } from "../paths.ts";
import { createClient, type TodoistClient } from "../todoist.ts";
import { mkdtempDisposableSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface TestContainer {
	readonly paths: ConfigPaths;
	readonly db: Mocked<Database>;
	readonly client: Mocked<TodoistClient>;

	addProject: (ref: ProjectRef) => void;
	removeProject: (id: string) => void;
	listProjects: () => ProjectRef[];
	listProjectIds: () => string[];
	projectCount: () => number;

	close(): void;
}

/**
 * Create a test container with injectable dependencies.
 *
 * If no overrides are provided, uses sensible test defaults:
 * - In-memory SQLite database
 * - Mock Projects backed by a memory store
 * - Mock TodoistClient that returns empty responses
 *
 * Example:
 * ```ts
 * test('sync command', () => {
 *   const mockClient = testClient()
 *     .sync({ projects: [] })
 *     .build()
 *
 *   const container = createTestContainer({
 *     client: mockClient,
 *     cwdPath: tempDir
 *   })
 *
 *   // use container for test
 *   container.close()
 * })
 * ```
 */
export function createTestContainer(overrides?: {
	database?: Database;
	projects?: string[];
}): TestContainer {
	// Use temp directory or provided path
	const testDir = mkdtempDisposableSync(
		join(tmpdir(), "doist-container-test-"),
	);
	const rcPath = join(testDir.path, ".doistrc");
	const dbPath = ":memory:";
	const paths = { rcPath, dbPath };

	// Use provided database or create in-memory one
	const db = overrides?.database ?? new Database(paths);

	// Use provided client or mock
	const client = vi.mockObject(createClient("test-token"));

	// Mock Projects with memory store
	const projects: Map<string, ProjectRef> = overrides?.projects
		? new Map(
				overrides.projects.map((id) => [id, { id, label: `Project ${id}` }]),
			)
		: new Map<string, ProjectRef>();

	return {
		addProject(ref: ProjectRef) {
			projects.set(ref.id, ref);
		},
		removeProject(id: string) {
			projects.delete(id);
		},
		listProjects(): ProjectRef[] {
			return Array.from(projects.values());
		},
		listProjectIds(): string[] {
			return Array.from(projects.keys());
		},
		projectCount(): number {
			return projects.size;
		},
		paths,
		db: vi.mocked(db),
		client,
		close() {
			testDir.remove();
			db.close();
		},
	};
}
