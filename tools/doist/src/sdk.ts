import { fetch } from "undici";
import * as v from "valibot";

const DueSchema = v.nullable(
	v.pipe(
		v.object({
			date: v.string(),
			string: v.string(),
			is_recurring: v.optional(v.boolean()),
		}),
		v.transform((d) => ({
			date: d.date,
			string: d.string,
			isRecurring: d.is_recurring ?? false,
		})),
	),
);

const ItemSchema = v.pipe(
	v.object({
		id: v.string(),
		project_id: v.string(),
		section_id: v.nullable(v.string()),
		content: v.string(),
		description: v.string(),
		priority: v.number(),
		due: DueSchema,
		labels: v.array(v.string()),
		checked: v.optional(v.boolean(), false),
		added_at: v.optional(v.nullable(v.string())),
		is_deleted: v.boolean(),
	}),
	v.transform((t) => ({
		id: t.id,
		projectId: t.project_id,
		sectionId: t.section_id,
		content: t.content,
		description: t.description,
		priority: t.priority,
		due: t.due,
		labels: t.labels,
		completed: t.checked,
		addedAt: t.added_at ? new Date(t.added_at) : null,
		isDeleted: t.is_deleted,
	})),
);

const ProjectSchema = v.pipe(
	v.object({
		id: v.string(),
		name: v.string(),
		color: v.optional(v.nullable(v.string())),
		is_favorite: v.optional(v.boolean(), false),
		inbox_project: v.optional(v.boolean()),
		is_deleted: v.boolean(),
		is_archived: v.boolean(),
	}),
	v.transform((p) => ({
		id: p.id,
		name: p.name,
		color: p.color ?? null,
		isFavorite: p.is_favorite,
		inboxProject: p.inbox_project ?? false,
		isDeleted: p.is_deleted,
		isArchived: p.is_archived,
	})),
);

const SectionSchema = v.pipe(
	v.object({
		id: v.string(),
		project_id: v.string(),
		name: v.string(),
		section_order: v.optional(v.number(), 0),
		is_deleted: v.boolean(),
		is_archived: v.optional(v.boolean()),
	}),
	v.transform((s) => ({
		id: s.id,
		projectId: s.project_id,
		name: s.name,
		sectionOrder: s.section_order,
		isDeleted: s.is_deleted,
		isArchived: s.is_archived ?? false,
	})),
);

const LabelSchema = v.pipe(
	v.object({
		id: v.string(),
		name: v.string(),
		color: v.optional(v.nullable(v.string())),
		is_deleted: v.boolean(),
	}),
	v.transform((l) => ({
		id: l.id,
		name: l.name,
		color: l.color ?? null,
		isDeleted: l.is_deleted,
	})),
);

const SyncStatusValueSchema = v.union([
	v.literal("ok"),
	v.pipe(
		v.object({ error: v.string(), error_code: v.optional(v.number()) }),
		v.transform((e) => ({
			error: e.error,
			...(e.error_code !== undefined && { errorCode: e.error_code }),
		})),
	),
]);

const SyncResponseSchema = v.pipe(
	v.object({
		sync_token: v.string(),
		sync_status: v.optional(v.record(v.string(), SyncStatusValueSchema)),
		items: v.optional(v.array(ItemSchema)),
		projects: v.optional(v.array(ProjectSchema)),
		sections: v.optional(v.array(SectionSchema)),
		labels: v.optional(v.array(LabelSchema)),
		temp_id_mapping: v.optional(v.record(v.string(), v.string())),
	}),
	v.transform((r) => ({
		syncToken: r.sync_token,
		syncStatus: r.sync_status,
		items: r.items,
		projects: r.projects,
		sections: r.sections,
		labels: r.labels,
		tempIdMapping: r.temp_id_mapping,
	})),
);

const parseSyncResponse = v.parser(SyncResponseSchema);

export type SyncResponse = v.InferOutput<typeof SyncResponseSchema>;
export type SyncItem = v.InferOutput<typeof ItemSchema>;
export type SyncProject = v.InferOutput<typeof ProjectSchema>;
export type SyncSection = v.InferOutput<typeof SectionSchema>;
export type SyncLabel = v.InferOutput<typeof LabelSchema>;

export type CommandFailure = {
	uuid: string;
	error: string;
	errorCode?: number;
};

export class SyncCommandError extends Error {
	readonly failures: CommandFailure[];

	constructor(failures: CommandFailure[]) {
		super(
			`Todoist command failed: ${failures.map((f) => `${f.uuid}: ${f.error}`).join(", ")}`,
		);
		this.name = "SyncCommandError";
		this.failures = failures;
	}
}

export type CommandType = "item_add" | "item_update" | "item_complete";

export type SyncCommand = {
	type: CommandType;
	uuid: string;
	args: Record<string, unknown>;
	temp_id?: string;
};

export function createCommand(
	type: CommandType,
	args: Record<string, unknown>,
	tempId?: string,
): SyncCommand {
	const command: SyncCommand = {
		type,
		uuid: crypto.randomUUID(),
		args,
	};

	if (tempId) {
		command.temp_id = tempId;
	}

	return command;
}

export async function syncRequest(
	token: string,
	params: Record<string, string>,
): Promise<SyncResponse> {
	const res = await fetch("https://api.todoist.com/api/v1/sync", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams(params),
	});
	if (!res.ok) {
		throw new Error(`Todoist sync failed: ${res.status} ${res.statusText}`);
	}
	const data = parseSyncResponse(await res.json());

	const failures: CommandFailure[] = [];
	for (const [uuid, s] of Object.entries(data.syncStatus ?? {})) {
		if (s !== "ok") {
			failures.push({ uuid, ...s });
		}
	}
	if (failures.length > 0) {
		throw new SyncCommandError(failures);
	}

	return data;
}
