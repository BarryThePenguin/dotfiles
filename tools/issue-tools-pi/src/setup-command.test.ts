import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	mkdirSync,
	mkdtempDisposableSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "doist-core";
import { toolInventory } from "issue-tools-core";
import wayfinderExtension from "./index.ts";

type CapturedNotify = {
	message: string;
	type: "info" | "warning" | "error";
};

type CapturedSelection = {
	title: string;
	options: string[];
};

type SetupOptions = {
	files?: Record<string, string>;
	dirs?: string[];
	hasUI?: boolean;
	selectResponses?: (string | undefined)[];
};

/**
 * Spin up a temp repo, seed files/dirs, build a mock UI, and capture the
 * `/setup-issue-tracker` handler. The returned object is disposable so the
 * test can scope the temp dir to the test body with `using t = setupTest(...)`.
 */
function setupTest(options: SetupOptions = {}) {
	const dir = mkdtempDisposableSync(join(tmpdir(), "wayfinder-setup-"));
	// `.git` directory is a findUp sentinel that stops the upward .doistrc
	// search; matching the convention in tracker.test.ts.
	mkdirSync(join(dir.path, ".git"));
	for (const [relPath, content] of Object.entries(options.files ?? {})) {
		const full = join(dir.path, relPath);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content, "utf8");
	}
	for (const relPath of options.dirs ?? []) {
		mkdirSync(join(dir.path, relPath), { recursive: true });
	}

	const notifications: CapturedNotify[] = [];
	const selections: CapturedSelection[] = [];
	const statuses: string[] = [];
	let responseIdx = 0;
	const responseQueue = options.selectResponses ?? [];

	const ctx = {
		cwd: dir.path,
		hasUI: options.hasUI ?? false,
		ui: {
			notify: (message: string, type: CapturedNotify["type"] = "info") => {
				notifications.push({ message, type });
			},
			confirm: () => Promise.resolve(true),
			input: () => Promise.resolve(undefined),
			select: (title: string, opts: string[]) => {
				selections.push({ title, options: opts });
				if (responseIdx < responseQueue.length) {
					const next = responseQueue[responseIdx];
					responseIdx++;
					return Promise.resolve(next);
				}
				return Promise.resolve(opts[0]);
			},
		},
	} as unknown as ExtensionCommandContext;

	const toolNames: string[] = [];
	const tools = new Map<
		string,
		{ execute?: (...args: unknown[]) => Promise<unknown> }
	>();
	let handler:
		((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
	let sessionStart:
		((event: unknown, ctx: ExtensionCommandContext) => void) | undefined;
	const api = {
		registerTool(def: {
			name: string;
			execute?: (...args: unknown[]) => Promise<unknown>;
		}) {
			toolNames.push(def.name);
			tools.set(def.name, def);
		},
		registerCommand(_name: string, options: { handler: typeof handler }) {
			handler = options.handler;
		},
		on(event: string, listener: typeof sessionStart) {
			if (event === "session_start") {
				sessionStart = listener;
			}
		},
	} as unknown as ExtensionAPI;
	wayfinderExtension(api);

	const sessionContext = {
		...ctx,
		sessionManager: { getBranch: () => [] },
		ui: {
			...ctx.ui,
			setStatus: (_key: string, text: string) => {
				statuses.push(text);
			},
			theme: { fg: (_color: string, text: string) => text },
		},
	} as unknown as ExtensionCommandContext;

	return {
		dir,
		notifications,
		selections,
		statuses,
		toolNames,
		tool: (name: string) => tools.get(name),
		startSession: () => {
			if (!sessionStart) {
				throw new Error("session_start handler was not registered");
			}
			sessionStart({}, sessionContext);
		},
		run: () => {
			if (!handler) {
				throw new Error("setup-issue-tracker command was not registered");
			}

			return handler("", ctx);
		},
		[Symbol.dispose]() {
			dir[Symbol.dispose]();
		},
	};
}

beforeEach(() => {
	vi.stubEnv("TODOIST_API_TOKEN", undefined);
	vi.stubEnv("TODOIST_RC_DIR", undefined);
});

describe("Tracker session lifecycle", () => {
	it("rebuilds Tracker state when a new session selects a different Issue tracker", async () => {
		using t = setupTest({ dirs: [".scratch"] });
		const issueList = t.tool("issue_list");
		if (!issueList?.execute) {
			throw new Error("issue_list tool was not registered");
		}

		const toolContext = {
			cwd: t.dir.path,
			hasUI: false,
			ui: {
				setStatus: () => {},
				theme: { fg: (_color: string, text: string) => text },
			},
		};

		// Bind the session to the test repo before the first tool call so the
		// local tracker is materialized under the temp dir, never the repo root.
		t.startSession();
		await issueList.execute("first", {}, undefined, undefined, toolContext);

		rmSync(join(t.dir.path, ".scratch"), { recursive: true, force: true });
		writeFileSync(
			join(t.dir.path, ".doistrc"),
			JSON.stringify({ projects: [{ id: "p1", label: "Work" }] }),
		);
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", t.dir.path);

		t.startSession();

		// The new session sees Todoist instead of reusing the prior local mode.
		// This status is produced by the session lifecycle after it resets the
		// cached Tracker and mode.
		expect(t.statuses.at(-1)).toContain("todoist");
	});
});

describe("/setup-issue-tracker command", () => {
	it("wires a fresh .doistrc end-to-end: marks the only project as repo: true", async () => {
		using t = setupTest({
			files: {
				".doistrc": JSON.stringify({
					projects: [{ id: "p1", label: "Work" }],
				}),
			},
			hasUI: true,
		});
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", t.dir.path);

		await t.run();

		// Re-read the .doistrc through the real container to verify the
		// marker landed.
		const projects = createContainer().listProjects();
		expect(projects).toEqual([{ id: "p1", label: "Work", repo: true }]);

		const success = t.notifications.find((n) =>
			n.message.includes("Marked p1"),
		);
		expect(success?.type).toBe("info");
		// Pin the full tool inventory so adding a tool forces an update here.
		for (const entry of toolInventory()) {
			expect(success?.message).toContain(entry.name);
		}
	});

	it("prompts with both options when .scratch and .doistrc are present", async () => {
		using t = setupTest({
			dirs: [".scratch"],
			files: {
				".doistrc": JSON.stringify({
					projects: [{ id: "p1", label: "Work" }],
				}),
			},
			hasUI: true,
		});

		await t.run();

		const prompt = t.selections[0];
		expect(prompt?.title).toBe("Issue tracker");
		expect(prompt?.options).toContain("Local Markdown (.scratch)");
		expect(prompt?.options).toContain("Todoist (.doistrc)");

		// The first option (Local) is auto-selected in the mock, so the
		// local notification fires.
		const local = t.notifications.find((n) =>
			n.message.includes("Local Markdown"),
		);
		expect(local?.type).toBe("info");
	});

	it("selects local directly when only .scratch is present", async () => {
		using t = setupTest({ dirs: [".scratch"] });

		await t.run();

		const local = t.notifications.find((n) =>
			n.message.includes("Local Markdown"),
		);
		expect(local?.type).toBe("info");
		expect(t.selections).toHaveLength(0);
	});

	it("errors when the repo is ambiguous and no UI is available", async () => {
		using t = setupTest({ hasUI: false });

		await t.run();

		const err = t.notifications.find((n) => n.type === "error");
		expect(err?.message).toContain("Cannot determine tracker");
	});

	it("errors when the user picks Todoist with an empty .doistrc", async () => {
		using t = setupTest({
			files: { ".doistrc": JSON.stringify({ projects: [] }) },
			hasUI: true,
			// An empty .doistrc reads as "neither", so the command prompts
			// first; picking Todoist then hits the no-projects error.
			selectResponses: ["Todoist (.doistrc)"],
		});
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", t.dir.path);

		await t.run();

		const err = t.notifications.find((n) => n.type === "error");
		expect(err?.message).toContain("No projects in .doistrc");
	});

	it("prompts for the repo project when .doistrc has more than one, marking the (repo) tag", async () => {
		using t = setupTest({
			files: {
				".doistrc": JSON.stringify({
					projects: [
						{ id: "p1", label: "First", repo: true },
						{ id: "p2", label: "Second" },
					],
				}),
			},
			hasUI: true,
			selectResponses: ["p2 — Second"],
		});
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", t.dir.path);

		await t.run();

		const prompt = t.selections[0];
		expect(prompt?.title).toContain("repo's Todoist project");
		expect(prompt?.options).toContain("p1 — First (repo)");
		expect(prompt?.options).toContain("p2 — Second");

		const success = t.notifications.find((n) =>
			n.message.includes("Marked p2"),
		);
		expect(success?.type).toBe("info");
	});

	it("treats a cancelled project prompt as a no-op", async () => {
		using t = setupTest({
			files: {
				".doistrc": JSON.stringify({
					projects: [
						{ id: "p1", label: "First" },
						{ id: "p2", label: "Second" },
					],
				}),
			},
			hasUI: true,
			selectResponses: [undefined],
		});
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", t.dir.path);

		await t.run();

		const cancel = t.notifications.find((n) => n.message.includes("cancelled"));
		expect(cancel?.type).toBe("info");
		// No marker should be written.
		const projects = createContainer().listProjects();
		expect(projects.find((p) => p.repo === true)).toBeUndefined();
	});

	it("picks the first project without prompting when no UI is available", async () => {
		using t = setupTest({
			files: {
				".doistrc": JSON.stringify({
					projects: [
						{ id: "p1", label: "First" },
						{ id: "p2", label: "Second" },
					],
				}),
			},
			hasUI: false,
		});
		vi.stubEnv("TODOIST_API_TOKEN", "test");
		vi.stubEnv("TODOIST_RC_DIR", t.dir.path);

		await t.run();

		const success = t.notifications.find((n) =>
			n.message.includes("Marked p1"),
		);
		expect(success?.type).toBe("info");
		expect(t.selections).toHaveLength(0);

		const projects = createContainer().listProjects();
		expect(projects).toEqual([
			{ id: "p1", label: "First", repo: true },
			{ id: "p2", label: "Second" },
		]);
	});
});
