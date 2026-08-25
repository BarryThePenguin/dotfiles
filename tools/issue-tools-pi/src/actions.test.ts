import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createInMemorySessionStateStore,
	createLocalTrackerModules,
	createTrackerSession,
} from "issue-tools-core";
import { handleAction } from "./actions.ts";

function tempDir() {
	return mkdtempDisposableSync(join(tmpdir(), "wayfinder-actions-"));
}

function makeContext(cwd: string) {
	const store = createInMemorySessionStateStore();
	const updateStatus = vi.fn();
	const trackerSession = createTrackerSession({
		cwd,
		selectMode: () => Promise.resolve("local"),
		buildLocalModules: () => createLocalTrackerModules(cwd),
		buildTodoistModules: vi.fn(),
		store,
		updateStatus,
	});
	return { trackerSession, store, updateStatus };
}

// Business-logic coverage for every action lives in
// issue-tools-core/src/actions.test.ts. These tests only prove that Pi's
// TrackerSession wires correctly into the shared runtime and that results
// are shaped into Pi's AgentToolResult { content, details } format.
describe("Pi action wiring", () => {
	it("shapes a successful result as { content: [{ type: 'text', text }], details: undefined }", async () => {
		using dir = tempDir();
		const { trackerSession } = makeContext(dir.path);

		const result = await handleAction("list_maps", {}, trackerSession);

		expect(result).toEqual({
			content: [{ type: "text", text: "No open wayfinder maps." }],
			details: undefined,
		});
	});

	it("shapes an error result as Error: <message>", async () => {
		using dir = tempDir();
		const { trackerSession } = makeContext(dir.path);

		const result = await handleAction("get_map", {}, trackerSession);

		expect(result).toEqual({
			content: [
				{
					type: "text",
					text: "Error: no map_id provided and no active map.",
				},
			],
			details: undefined,
		});
	});

	it("carries session state through the runtime (active map persists to the store)", async () => {
		using dir = tempDir();
		const modules = createLocalTrackerModules(dir.path);
		const map = await modules.wayfinder.createMap({
			title: "GENIE 2780",
			destination: "A clear handoff exists.",
		});
		const { trackerSession, store, updateStatus } = makeContext(dir.path);

		await handleAction("list_maps", {}, trackerSession);

		expect(trackerSession.getActiveMap()).toBe(map.id);
		expect(store.read().activeMap).toBe(map.id);
		expect(updateStatus).toHaveBeenCalledWith({
			mode: "local",
			activeMap: map.id,
			cwd: dir.path,
		});
	});
});
