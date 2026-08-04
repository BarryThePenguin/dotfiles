import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	issueFileBodyFromMarkdown,
	issueMarkdown,
} from "./issue-file-format.ts";
import type { CreateIssueInput, Issue, IssueComment } from "./issue.ts";
import {
	mapBodyFromDocument,
	renderMapBody,
	replaceMapSection,
} from "./map-body.ts";
import type { MapSectionKey } from "./schema.ts";

import { setClaimedByOnDocument } from "./ticket-body.ts";
import {
	compareTicketIds,
	LOCAL_TICKET_STATUS_OPEN,
	LOCAL_TICKET_STATUS_RESOLVED,
	mapFileUrl,
	mapMarkdown,
	normalizeTicketIdForMap,
	setAnswerOnDocument,
	setBlockedByRefsOnDocument,
	slugify,
	stripResolutionHeading,
	ticketFileBodyFromDocument,
	ticketFileUrl,
	ticketMarkdown,
	ticketNumberFromRef,
	ticketRefFromId,
	titleFromSlug,
} from "./local-file-format.ts";
import {
	markdownDocument,
	type WayfinderMarkdownDocument,
} from "./wayfinder-markdown.ts";
import type { DecisionSummary } from "./schema.ts";
import { canClaimTicket } from "./tracker-operations.ts";
import {
	ClosedTicketWithoutResolutionError,
	type CreateWayfinderChildTicketInput,
	type CreateWayfinderMapInput,
	type WayfinderClaimResult,
	type WayfinderTrackerMap,
	type WayfinderTrackerTicket,
} from "./tracker.ts";

type TicketFileInfo = {
	mapId: string;
	ref: string;
	path: string;
};

/** Persistence adapter for the Local Markdown Issue tracker. */
export class LocalMarkdownAdapter {
	readonly #rootDir: string;
	#indexLock = Promise.resolve();

	constructor(rootDir: string) {
		this.#rootDir = rootDir;
	}

	async createMap(
		input: CreateWayfinderMapInput,
	): Promise<WayfinderTrackerMap> {
		return this.#withIndexLock(async () => {
			await this.#ensureLayout();
			const id = await this.#allocateSlug(input.title, (slug) =>
				this.#mapExists(slug),
			);

			await mkdir(this.#mapDir(id), { recursive: true });
			await mkdir(this.#issuesDir(id), { recursive: true });
			await this.#writeMapBody(id, mapMarkdown(input.title, input));

			return this.getMap(id);
		});
	}

	async createChildTicket(
		input: CreateWayfinderChildTicketInput,
	): Promise<WayfinderTrackerTicket> {
		return this.#withIndexLock(async () => {
			const mapId = this.#mapId(input.mapId);
			await this.getMap(mapId);
			await mkdir(this.#issuesDir(mapId), { recursive: true });
			const nextNumber = await this.#nextTicketNumber(mapId);
			const ref = `${String(nextNumber).padStart(2, "0")}-${slugify(input.title)}`;
			const id = `${mapId}/${ref}`;
			const blockerRefs = (input.blockerIds ?? []).map(ticketRefFromId);

			await writeFile(
				this.#ticketPathFromParts(mapId, ref),
				ticketMarkdown({
					number: nextNumber,
					title: input.title,
					type: input.type,
					status: LOCAL_TICKET_STATUS_OPEN,
					question: input.question,
					blockerRefs,
				}),
			);

			return this.getTicket(id);
		});
	}

	async getMap(id: string): Promise<WayfinderTrackerMap> {
		const mapId = this.#mapId(id);
		const document = await this.#readMapDocument(mapId);
		return {
			id: mapId,
			title: document.title() ?? titleFromSlug(mapId),
			url: mapFileUrl(mapId),
			...mapBodyFromDocument(document),
		};
	}

	async getTicket(id: string): Promise<WayfinderTrackerTicket> {
		const info = this.#ticketInfo(id);
		const document = await this.#readTicketDocument(info);
		const parsed = ticketFileBodyFromDocument(document);
		const blockerIds = parsed.blockerRefs.map((ref) =>
			normalizeTicketIdForMap(info.mapId, ref),
		);

		return {
			id: `${info.mapId}/${info.ref}`,
			mapId: info.mapId,
			title: parsed.title,
			type: parsed.type,
			question: parsed.question,
			blockerIds,
			...(parsed.claimedBy ? { claimedBy: parsed.claimedBy } : {}),
			url: ticketFileUrl(info.ref),
			status: parsed.status,
			// The local adapter stores the Resolution in its first `## Answer`
			// section, but the shared ticket model exposes it as a comment.
			comments: parsed.answer
				? [parsed.answer, ...parsed.comments]
				: parsed.comments,
		};
	}

	async listMaps(): Promise<WayfinderTrackerMap[]> {
		await this.#ensureLayout();
		const entries = await readdir(this.#rootDir, { withFileTypes: true });
		const ids = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.toSorted();
		const maps: WayfinderTrackerMap[] = [];
		for (const id of ids) {
			if (await this.#mapExists(id)) {
				maps.push(await this.getMap(id));
			}
		}
		return maps;
	}

	async listTickets(): Promise<WayfinderTrackerTicket[]> {
		const maps = await this.listMaps();
		const ticketLists = await Promise.all(
			maps.map((map) => this.listChildTickets(map.id)),
		);
		return ticketLists.flat().toSorted((a, b) => compareTicketIds(a.id, b.id));
	}

	async getTicketBody(id: string): Promise<WayfinderTrackerTicket> {
		return this.getTicket(id);
	}

	async listChildTicketBodies(
		mapId: string,
	): Promise<WayfinderTrackerTicket[]> {
		return this.listChildTickets(mapId);
	}

	async listChildTickets(mapId: string): Promise<WayfinderTrackerTicket[]> {
		const normalizedMapId = this.#mapId(mapId);
		await this.getMap(normalizedMapId);
		try {
			const entries = await readdir(this.#issuesDir(normalizedMapId), {
				withFileTypes: true,
			});
			return await Promise.all(
				entries
					.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
					.map(
						(entry) => `${normalizedMapId}/${entry.name.replace(/\.md$/, "")}`,
					)
					.toSorted(compareTicketIds)
					.map((ticketId) => this.getTicket(ticketId)),
			);
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return [];
			}
			throw error;
		}
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<WayfinderClaimResult> {
		return this.#withIndexLock(async () => {
			const ticket = await this.getTicket(id);
			if (!canClaimTicket(ticket)) {
				return { claimed: false, ticket };
			}

			const info = this.#ticketInfo(id);
			const document = await this.#readTicketDocument(info);
			setClaimedByOnDocument(document, claimant);
			await writeFile(info.path, document.stringify());

			return { claimed: true, ticket: await this.getTicket(id) };
		});
	}

	async writeMapDecisions(
		mapId: string,
		decisions: DecisionSummary[],
	): Promise<WayfinderTrackerMap> {
		const normalizedMapId = this.#mapId(mapId);
		await this.getMap(normalizedMapId);
		const current = mapBodyFromDocument(
			await this.#readMapDocument(normalizedMapId),
		);
		await this.#writeMapBody(
			normalizedMapId,
			renderMapBody({ ...current, decisionsSoFar: decisions }),
		);
		return this.getMap(normalizedMapId);
	}

	async writeMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<WayfinderTrackerMap> {
		const normalizedMapId = this.#mapId(mapId);
		await this.getMap(normalizedMapId);
		const nextBody = replaceMapSection(
			await this.#readMapBody(normalizedMapId),
			section,
			content,
		);
		await this.#writeMapBody(normalizedMapId, nextBody);
		return this.getMap(normalizedMapId);
	}

	async unclaimTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#withIndexLock(async () => {
			const info = this.#ticketInfo(id);
			await this.getTicket(id);
			const document = await this.#readTicketDocument(info);
			setClaimedByOnDocument(document, undefined);
			await writeFile(info.path, document.stringify());
			return this.getTicket(id);
		});
	}

	async closeTicket(id: string): Promise<WayfinderTrackerTicket> {
		return this.#withIndexLock(async () => {
			const info = this.#ticketInfo(id);
			await this.getTicket(id);
			const document = await this.#readTicketDocument(info);
			document.setHeader("Status", LOCAL_TICKET_STATUS_RESOLVED);
			await writeFile(info.path, document.stringify());
			return this.getTicket(id);
		});
	}

	async recordResolution(
		id: string,
		resolution: string,
	): Promise<WayfinderTrackerTicket> {
		return this.#withIndexLock(async () => {
			const info = this.#ticketInfo(id);
			const document = await this.#readTicketDocument(info);
			const parsed = ticketFileBodyFromDocument(document);
			const canonicalResolution = stripResolutionHeading(resolution);
			const existingResolution = parsed.answer?.trim();
			const isClosed = parsed.status === "closed";

			if (canonicalResolution.length === 0) {
				throw new Error("Resolution must not be empty.");
			}
			if (existingResolution !== undefined) {
				if (existingResolution !== canonicalResolution) {
					throw new Error(
						`Resolution for ticket ${id} is already recorded and cannot be replaced.`,
					);
				}
				if (isClosed) {
					return this.getTicket(id);
				}
			} else if (isClosed) {
				throw new ClosedTicketWithoutResolutionError(id);
			}

			setAnswerOnDocument(document, canonicalResolution);
			document.setHeader("Status", LOCAL_TICKET_STATUS_RESOLVED);
			await writeFile(info.path, document.stringify());
			return this.getTicket(id);
		});
	}
	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<WayfinderTrackerTicket> {
		const info = this.#ticketInfo(id);
		await this.getTicket(id);
		await Promise.all(blockerIds.map((blockerId) => this.getTicket(blockerId)));
		const document = await this.#readTicketDocument(info);
		setBlockedByRefsOnDocument(document, blockerIds.map(ticketRefFromId));
		await writeFile(info.path, document.stringify());
		return this.getTicket(id);
	}

	#withIndexLock<Result>(operation: () => Promise<Result>): Promise<Result> {
		const run = this.#indexLock.then(operation, operation);
		this.#indexLock = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	// -- Generic issue persistence --------------------------------------

	async createIssueRecord(input: CreateIssueInput): Promise<Issue> {
		return this.#withIndexLock(async () => {
			await this.#ensureLayout();
			const slug = await this.#nextIssueSlug(input.title);
			const updatedAt = new Date().toISOString();
			const body = issueMarkdown({
				title: input.title,
				body: input.body ?? "",
				labels: input.labels ?? [],
				status: "open",
				updatedAt,
			});
			await writeFile(this.#issuePath(slug), body);
			return this.readIssueRecord(slug);
		});
	}

	async readIssueRecord(id: string): Promise<Issue> {
		const slug = this.#issueSlugFromIdOrUrl(id);
		const path = this.#issuePath(slug);
		const markdown = await readFile(path, "utf8");
		const parsed = issueFileBodyFromMarkdown(markdown);
		const fallbackUpdatedAt = parsed.updatedAt
			? undefined
			: await this.#statMtime(path);
		const updatedAt = parsed.updatedAt ?? fallbackUpdatedAt;
		return {
			id: slug,
			url: `${slug}.md`,
			title: parsed.title,
			body: parsed.body,
			labels: parsed.labels,
			status: parsed.status,
			comments: parsed.comments.map((content) => ({ content })),
			...(updatedAt ? { updatedAt } : {}),
		};
	}

	async writeIssueLabels(id: string, labels: string[]): Promise<Issue> {
		return this.#withIndexLock(async () => {
			const slug = this.#issueSlugFromIdOrUrl(id);
			const path = this.#issuePath(slug);
			const current = await this.readIssueRecord(slug);
			const updatedAt = new Date().toISOString();
			const body = issueMarkdown({
				title: current.title,
				body: current.body,
				labels,
				status: current.status,
				...(current.status === "closed" && current.updatedAt
					? { updatedAt: current.updatedAt }
					: {}),
				comments: current.comments,
				...(current.comments.length === 0 ? {} : { updatedAt }),
			});
			await writeFile(path, body);
			return this.readIssueRecord(slug);
		});
	}

	async appendIssueComment(
		id: string,
		body: string,
	): Promise<{ comment: IssueComment }> {
		return this.#withIndexLock(async () => {
			const slug = this.#issueSlugFromIdOrUrl(id);
			const path = this.#issuePath(slug);
			const current = await this.readIssueRecord(slug);
			const nextComments = [...current.comments, { content: body }];
			const updatedAt = new Date().toISOString();
			const next = issueMarkdown({
				title: current.title,
				body: current.body,
				labels: current.labels,
				status: current.status,
				...(current.status === "closed" && current.updatedAt
					? { updatedAt: current.updatedAt }
					: {}),
				comments: nextComments,
				...(current.status === "closed" ? {} : { updatedAt }),
			});
			await writeFile(path, next);
			return { comment: { content: body } };
		});
	}

	async closeIssueRecord(
		id: string,
		options?: { comment?: string },
	): Promise<{ status: "open" | "closed" }> {
		return this.#withIndexLock(async () => {
			const slug = this.#issueSlugFromIdOrUrl(id);
			const path = this.#issuePath(slug);
			const current = await this.readIssueRecord(slug);
			const comments = options?.comment
				? [...current.comments, { content: options.comment }]
				: current.comments;
			const updatedAt = new Date().toISOString();
			const next = issueMarkdown({
				title: current.title,
				body: current.body,
				labels: current.labels,
				status: "closed",
				updatedAt,
				comments,
			});
			await writeFile(path, next);
			return { status: "closed" as const };
		});
	}

	async listIssueRecords(): Promise<Issue[]> {
		await this.#ensureLayout();
		const entries = await readdir(this.#rootDir, { withFileTypes: true });
		const slugs = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name.replace(/\.md$/, ""))
			.toSorted();
		const issues: Issue[] = [];
		for (const slug of slugs) {
			try {
				issues.push(await this.readIssueRecord(slug));
			} catch {
				// Skip unreadable files
			}
		}
		return issues;
	}

	async #ensureLayout(): Promise<void> {
		await mkdir(this.#rootDir, { recursive: true });
	}

	#mapId(idOrUrl: string): string {
		const withoutTrailingSlash = idOrUrl.replace(/\/+$/, "");
		return basename(withoutTrailingSlash.replace(/\/?map\.md$/, ""));
	}

	#mapDir(id: string): string {
		return join(this.#rootDir, this.#mapId(id));
	}

	#issuesDir(mapId: string): string {
		return join(this.#mapDir(mapId), "issues");
	}

	#mapPath(id: string): string {
		return join(this.#mapDir(id), "map.md");
	}

	#ticketPathFromParts(mapId: string, ref: string): string {
		return join(this.#issuesDir(mapId), `${ref}.md`);
	}

	#ticketInfo(id: string): TicketFileInfo {
		const withoutMarkdown = id.replace(/\.md$/, "");
		const issuePathMatch = /([^/]+)\/issues\/([^/]+)$/.exec(withoutMarkdown);
		if (issuePathMatch?.[1] && issuePathMatch[2]) {
			return {
				mapId: issuePathMatch[1],
				ref: issuePathMatch[2],
				path: this.#ticketPathFromParts(issuePathMatch[1], issuePathMatch[2]),
			};
		}

		const [mapId, ref] = withoutMarkdown.split("/", 2);
		if (!mapId || !ref) {
			throw new Error(
				`Local Wayfinder ticket id must be <map>/<NN-slug>: ${id}`,
			);
		}
		return {
			mapId,
			ref,
			path: this.#ticketPathFromParts(mapId, ref),
		};
	}

	async #readMapBody(id: string): Promise<string> {
		return readFile(this.#mapPath(id), "utf8");
	}

	async #readMapDocument(id: string): Promise<WayfinderMarkdownDocument> {
		return markdownDocument(await this.#readMapBody(id));
	}

	async #readTicketDocument(
		info: TicketFileInfo,
	): Promise<WayfinderMarkdownDocument> {
		return markdownDocument(await readFile(info.path, "utf8"));
	}

	async #writeMapBody(id: string, body: string): Promise<void> {
		await this.#ensureLayout();
		await mkdir(this.#mapDir(id), { recursive: true });
		await writeFile(this.#mapPath(id), body);
	}

	async #mapExists(id: string): Promise<boolean> {
		return this.#fileExists(this.#mapPath(id));
	}

	async #nextTicketNumber(mapId: string): Promise<number> {
		try {
			const entries = await readdir(this.#issuesDir(mapId), {
				withFileTypes: true,
			});
			const max = entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.map((entry) => ticketNumberFromRef(entry.name.replace(/\.md$/, "")))
				.filter((number): number is number => number !== undefined)
				.reduce((current, number) => Math.max(current, number), 0);
			return max + 1;
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return 1;
			}
			throw error;
		}
	}

	#issuePath(slug: string): string {
		return join(this.#rootDir, `${slug}.md`);
	}

	#issueSlugFromIdOrUrl(idOrUrl: string): string {
		const trimmed = idOrUrl.trim();
		const fileNameMatch = /([^/]+)\.md$/.exec(trimmed);
		if (fileNameMatch?.[1]) {
			return fileNameMatch[1];
		}
		return trimmed;
	}

	async #nextIssueSlug(title: string): Promise<string> {
		return this.#allocateSlug(title, (slug) => this.#issueExists(slug));
	}

	async #allocateSlug(
		title: string,
		exists: (slug: string) => Promise<boolean>,
	): Promise<string> {
		const baseSlug = slugify(title);
		let slug = baseSlug;
		let suffix = 2;
		while (await exists(slug)) {
			slug = `${baseSlug}-${suffix}`;
			suffix += 1;
		}
		return slug;
	}

	async #issueExists(slug: string): Promise<boolean> {
		return this.#fileExists(this.#issuePath(slug));
	}

	async #fileExists(path: string): Promise<boolean> {
		try {
			await readFile(path, "utf8");
			return true;
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return false;
			}
			throw error;
		}
	}

	async #statMtime(path: string): Promise<string | undefined> {
		try {
			const stats = await stat(path);
			return stats.mtime.toISOString();
		} catch {
			return undefined;
		}
	}
}
