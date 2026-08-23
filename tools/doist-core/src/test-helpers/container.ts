/**
 * Test utilities for creating containers with mock dependencies.
 *
 * Use createTestContainer in unit tests to avoid real HTTP calls, file I/O,
 * and database initialization overhead.
 */

import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, type Mocked } from "vitest";
import { driverFactory } from "sqlite-runtime";
import type {
	OperationalContainer,
	ProjectRef,
	ConfigPaths,
} from "../container.ts";
import { Database } from "../db.ts";
import { createClient, type TodoistClient } from "../todoist.ts";

/** OperationalContainer with narrowed mock types for test code. */
export interface TestContainer extends OperationalContainer {
	readonly paths: ConfigPaths;
	readonly db: Mocked<Database>;
	readonly client: Mocked<TodoistClient>;
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
	const paths = { rcPath };

	// Use provided database or create in-memory one
	const db =
		overrides?.database ?? new Database({ driver: driverFactory(dbPath) });

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
		setRepoProject(id: string) {
			for (const [projectId, project] of projects) {
				projects.set(projectId, {
					...project,
					repo: projectId === id ? true : undefined,
				});
			}
		},
		sync: vi.fn().mockResolvedValue({
			data: {
				projects: [],
				sections: [],
				labels: [],
				filters: [],
				tasks: [],
				notes: [],
				completedTaskIds: [],
				deletedTaskIds: [],
				deletedNoteIds: [],
				syncToken: "",
			},
			reconciled: 0,
		}),
		paths,
		db: vi.mocked(db),
		client,
		close() {
			testDir.remove();
			db.close();
		},
	} satisfies OperationalContainer;
}
