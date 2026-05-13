import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { env } from "./env.ts";

const ProjectRefSchema = v.object({
	id: v.string(),
	label: v.string(),
});

export type ProjectRef = v.InferOutput<typeof ProjectRefSchema>;

const ConfigSchema = v.object({
	projects: v.array(ProjectRefSchema),
});

export type Config = v.InferOutput<typeof ConfigSchema>;

const parseConfig = v.parser(v.pipe(v.string(), v.parseJson(), ConfigSchema));

function findDoistDir(from: string = process.cwd()): string {
	let dir = from;
	let parent = dirname(dir);
	while (parent !== dir) {
		if (existsSync(join(dir, ".doistrc"))) {
			return dir;
		}
		dir = parent;
		parent = dirname(dir);
	}
	return from;
}

export function findPaths(from: string = process.cwd()): {
	rcPath: string;
	dbPath: string;
} {
	const dir = findDoistDir(from);
	return {
		rcPath: env.TODOIST_RC_PATH ?? join(dir, ".doistrc"),
		dbPath: env.TODOIST_DB_PATH ?? join(dir, "todoist.db"),
	};
}

function readConfig(path: string): Config {
	if (!existsSync(path)) {
		return { projects: [] };
	}
	return parseConfig(readFileSync(path, "utf8"));
}

export function writeConfig(path: string, config: Config): void {
	writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

export function listProjects(path: string): ProjectRef[] {
	const config = readConfig(path);
	return config.projects;
}

export function listProjectIds(path: string): string[] {
	const projects = listProjects(path);
	return projects.map((p) => p.id);
}

export function addProject(path: string, ref: ProjectRef): void {
	const projects = listProjects(path);
	if (!projects.some((p) => p.id === ref.id)) {
		projects.push(ref);
		writeConfig(path, { projects });
	}
}

export function removeProject(path: string, id: string): void {
	const projects = listProjects(path).filter((p) => p.id !== id);
	if (projects.length !== listProjects(path).length) {
		writeConfig(path, { projects });
	}
}
