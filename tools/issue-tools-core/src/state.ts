import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type StateStore<T> = {
	read(): T;
	write(state: T): void;
};

function stateFile(worktree: string, host: string): string {
	const base = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
	const key = worktree.replace(/[^a-zA-Z0-9._-]/g, "-");
	return join(base, "issue-tools", host, key, "state.json");
}

export function createFileStateStore<T>(
	worktree: string,
	host: string,
	defaults: T,
): StateStore<T> {
	const file = stateFile(worktree, host);
	return {
		read() {
			try {
				return JSON.parse(readFileSync(file, "utf8")) as T;
			} catch {
				return defaults;
			}
		},
		write(state) {
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
		},
	};
}
