import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TrackerMode } from "issue-tools-core";

export type SessionState = {
	mode?: TrackerMode;
	activeMap: string | null;
};

export type StateStore = {
	read(): SessionState;
	write(state: SessionState): void;
};

function stateFile(worktree: string): string {
	const base = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
	const key = worktree.replace(/[^a-zA-Z0-9._-]/g, "-");
	return join(base, "issue-tools", "claude", key, "state.json");
}

export function createStateStore(worktree: string): StateStore {
	const file = stateFile(worktree);
	return {
		read() {
			try {
				const parsed = JSON.parse(readFileSync(file, "utf8")) as SessionState;
				return {
					...(parsed.mode ? { mode: parsed.mode } : {}),
					activeMap: parsed.activeMap ?? null,
				};
			} catch {
				return { activeMap: null };
			}
		},
		write(state) {
			const data = {
				...(state.mode ? { mode: state.mode } : {}),
				activeMap: state.activeMap,
			};
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
		},
	};
}
