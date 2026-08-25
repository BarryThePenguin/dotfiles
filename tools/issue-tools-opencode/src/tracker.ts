/**
 * opencode tracker session.
 *
 * Delegates mode selection, module building, and file-backed state to the
 * shared issue-tools-core session lifecycle. Unlike the Pi extension (which
 * asks via the TUI and stores state in the session), opencode keeps a
 * durable per-worktree session, cached in a registry keyed by worktree.
 */

import {
	createFileBackedTrackerSession,
	type FileBackedTrackerSession,
} from "issue-tools-core";

export type SessionRegistry = {
	get(worktree: string): FileBackedTrackerSession;
};

export function createSessionRegistry(): SessionRegistry {
	const sessions = new Map<string, FileBackedTrackerSession>();
	return {
		get(worktree: string): FileBackedTrackerSession {
			let session = sessions.get(worktree);
			if (!session) {
				session = createFileBackedTrackerSession(worktree, "opencode");
				sessions.set(worktree, session);
			}
			return session;
		},
	};
}
