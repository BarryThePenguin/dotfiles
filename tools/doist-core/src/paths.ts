import { dirname, join } from "node:path";

export interface ConfigPaths {
	dbPath: string;
	rcPath: string;
}

interface FindDoistDirOptions {
	exists: (path: string) => boolean;
}

export function findDoistDir(
	start: string,
	{ exists }: FindDoistDirOptions,
): string | null {
	let dir = start;
	let parent = dirname(dir);

	while (parent !== dir) {
		if (exists(join(dir, ".doistrc"))) {
			return dir;
		}
		if (exists(join(dir, ".git"))) {
			return null;
		}
		dir = parent;
		parent = dirname(dir);
	}

	if (exists(join(dir, ".doistrc"))) {
		return dir;
	}

	return null;
}

export function findPaths(
	from: string,
	{ exists }: FindDoistDirOptions,
): ConfigPaths | null {
	const dir = findDoistDir(from, { exists });

	if (!dir) {
		return null;
	}

	return {
		rcPath: join(dir, ".doistrc"),
		dbPath: join(dir, "todoist.db"),
	};
}
