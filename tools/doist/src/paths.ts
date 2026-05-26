import { dirname, join } from "node:path";

export interface ConfigPaths {
	dbPath: string;
	rcPath: string;
}

interface FindDoistDirOptions {
	exists: (path: string) => boolean;
}

export function findDoistDir(start: string, { exists }: FindDoistDirOptions) {
	let dir = start;
	let parent = dirname(dir);

	while (parent !== dir) {
		const rcExists = exists(join(dir, ".doistrc"));
		if (rcExists) {
			return dir;
		}
		dir = parent;
		parent = dirname(dir);
	}
	return start;
}

export function findPaths(
	from: string,
	{ exists }: FindDoistDirOptions,
): {
	rcPath: string;
	dbPath: string;
} {
	const dir = findDoistDir(from, { exists });
	return {
		rcPath: join(dir, ".doistrc"),
		dbPath: join(dir, "todoist.db"),
	};
}
