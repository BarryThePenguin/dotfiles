import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mapBodyFromDocument, type MapSectionKey } from "./map-body.ts";
import { stringifyMarkdown } from "./markdown.ts";
import {
	compareTicketIds,
	mapFileUrl,
	mapMarkdown,
	normalizeTicketIdForMap,
	setBlockedBySectionOnRoot,
	setSectionOnRoot,
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
	setHeaderOnRoot,
	type WayfinderMarkdownDocument,
} from "./wayfinder-markdown.ts";
import type { DecisionSummary } from "./schema.ts";
import {
	addBlockingDependency as addBlockingDependencyOperation,
	canClaimTicket,
	listFrontierTickets as listFrontierTicketsOperation,
	recordDecision as recordDecisionOperation,
	updateMapSection as updateMapSectionOperation,
} from "./tracker-operations.ts";
import type {
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	WayfinderClaimResult,
	WayfinderTicketStatus,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "./tracker.ts";

export type LocalTicketStatus = WayfinderTicketStatus;
export type LocalMap = WayfinderTrackerMap;
export type LocalTicket = WayfinderTrackerTicket;
export type CreateLocalMapInput = CreateWayfinderMapInput;
export type CreateLocalChildTicketInput = CreateWayfinderChildTicketInput;
export type LocalClaimResult = WayfinderClaimResult;

type TicketFileInfo = {
	mapId: string;
	ref: string;
	path: string;
};

export class LocalMarkdownTracker {
	readonly #rootDir: string;
	#indexLock = Promise.resolve();

	constructor(rootDir: string) {
		this.#rootDir = rootDir;
	}

	async createMap(input: CreateLocalMapInput): Promise<LocalMap> {
		return this.#withIndexLock(async () => {
			await this.#ensureLayout();
			const baseSlug = slugify(input.title);
			let id = baseSlug;
			let suffix = 2;
			while (await this.#mapExists(id)) {
				id = `${baseSlug}-${suffix}`;
				suffix += 1;
			}

			await mkdir(this.#mapDir(id), { recursive: true });
			await mkdir(this.#issuesDir(id), { recursive: true });
			await this.#writeMapBody(id, mapMarkdown(input.title, input));

			return this.getMap(id);
		});
	}

	async createChildTicket(
		input: CreateLocalChildTicketInput,
	): Promise<LocalTicket> {
		return this.#withIndexLock(async () => {
			await this.getMap(input.mapId);
			await mkdir(this.#issuesDir(input.mapId), { recursive: true });
			const nextNumber = await this.#nextTicketNumber(input.mapId);
			const ref = `${String(nextNumber).padStart(2, "0")}-${slugify(input.title)}`;
			const id = `${input.mapId}/${ref}`;
			const blockerRefs = (input.blockerIds ?? []).map(ticketRefFromId);

			await writeFile(
				this.#ticketPathFromParts(input.mapId, ref),
				ticketMarkdown({
					number: nextNumber,
					title: input.title,
					type: input.type,
					status: "open",
					question: input.question,
					blockerRefs,
				}),
			);

			return this.getTicket(id);
		});
	}

	async getMap(id: string): Promise<LocalMap> {
		const document = await this.#readMapDocument(id);
		return {
			id,
			title: document.title() ?? titleFromSlug(id),
			url: mapFileUrl(id),
			...mapBodyFromDocument(document),
		};
	}

	async getTicket(id: string): Promise<LocalTicket> {
		const info = this.#ticketInfo(id);
		const document = await this.#readTicketDocument(info);
		const parsed = ticketFileBodyFromDocument(document);
		const status: LocalTicketStatus =
			parsed.status.toLowerCase() === "resolved" ? "closed" : "open";
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
			status,
			comments: parsed.comments,
			...(parsed.answer ? { answer: parsed.answer } : {}),
		};
	}

	async listMaps(): Promise<LocalMap[]> {
		await this.#ensureLayout();
		const entries = await readdir(this.#rootDir, { withFileTypes: true });
		const ids = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.toSorted();
		const maps: LocalMap[] = [];
		for (const id of ids) {
			if (await this.#mapExists(id)) {
				maps.push(await this.getMap(id));
			}
		}
		return maps;
	}

	async listTickets(): Promise<LocalTicket[]> {
		const maps = await this.listMaps();
		const ticketLists = await Promise.all(
			maps.map((map) => this.listChildTickets(map.id)),
		);
		return ticketLists.flat().toSorted((a, b) => compareTicketIds(a.id, b.id));
	}

	async listChildTickets(mapId: string): Promise<LocalTicket[]> {
		await this.getMap(mapId);
		try {
			const entries = await readdir(this.#issuesDir(mapId), {
				withFileTypes: true,
			});
			return await Promise.all(
				entries
					.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
					.map((entry) => `${mapId}/${entry.name.replace(/\.md$/, "")}`)
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

	async listFrontierTickets(mapId: string): Promise<LocalTicket[]> {
		return listFrontierTicketsOperation(this, mapId);
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<LocalClaimResult> {
		return this.#withIndexLock(async () => {
			const ticket = await this.getTicket(id);
			if (!canClaimTicket(ticket)) {
				return { claimed: false, ticket };
			}

			const info = this.#ticketInfo(id);
			const { root } = await this.#readTicketDocument(info);
			setHeaderOnRoot(root, "Status", "claimed");
			setHeaderOnRoot(root, "Claimed by", claimant);
			await writeFile(info.path, stringifyMarkdown(root));

			return { claimed: true, ticket: await this.getTicket(id) };
		});
	}

	async updateMapBody(id: string, body: string): Promise<LocalMap> {
		await this.getMap(id);
		await this.#writeMapBody(id, body);
		return this.getMap(id);
	}

	async updateTicketBody(id: string, body: string): Promise<LocalTicket> {
		const info = this.#ticketInfo(id);
		await this.getTicket(id);
		await writeFile(info.path, body);
		return this.getTicket(id);
	}

	async unclaimTicket(id: string): Promise<LocalTicket> {
		return this.#withIndexLock(async () => {
			const info = this.#ticketInfo(id);
			await this.getTicket(id);
			const { root } = await this.#readTicketDocument(info);
			setHeaderOnRoot(root, "Status", "open");
			setHeaderOnRoot(root, "Claimed by", undefined);
			await writeFile(info.path, stringifyMarkdown(root));
			return this.getTicket(id);
		});
	}

	async closeTicket(id: string): Promise<LocalTicket> {
		return this.#withIndexLock(async () => {
			const info = this.#ticketInfo(id);
			await this.getTicket(id);
			const { root } = await this.#readTicketDocument(info);
			setHeaderOnRoot(root, "Status", "resolved");
			await writeFile(info.path, stringifyMarkdown(root));
			return this.getTicket(id);
		});
	}

	async postComment(id: string, body: string): Promise<void> {
		return this.#withIndexLock(async () => {
			const info = this.#ticketInfo(id);
			await this.getTicket(id);
			const { root } = await this.#readTicketDocument(info);
			setSectionOnRoot(root, "Answer", stripResolutionHeading(body));
			await writeFile(info.path, stringifyMarkdown(root));
		});
	}

	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<LocalTicket> {
		const info = this.#ticketInfo(id);
		await this.getTicket(id);
		await Promise.all(blockerIds.map((blockerId) => this.getTicket(blockerId)));
		const { root } = await this.#readTicketDocument(info);
		setBlockedBySectionOnRoot(root, blockerIds.map(ticketRefFromId));
		await writeFile(info.path, stringifyMarkdown(root));
		return this.getTicket(id);
	}

	async addBlockingDependency(
		id: string,
		blockerId: string,
	): Promise<LocalTicket> {
		return addBlockingDependencyOperation(this, id, blockerId);
	}

	async recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<LocalMap> {
		await this.getMap(mapId);
		return recordDecisionOperation(
			{
				readMapBody: (id) => this.#readMapBody(id),
				writeMapBody: async (id, body) => {
					await this.#writeMapBody(id, body);
					return this.getMap(id);
				},
			},
			mapId,
			decision,
		);
	}

	async updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<LocalMap> {
		await this.getMap(mapId);
		return updateMapSectionOperation(
			{
				readMapBody: (id) => this.#readMapBody(id),
				writeMapBody: async (id, body) => {
					await this.#writeMapBody(id, body);
					return this.getMap(id);
				},
			},
			mapId,
			section,
			content,
		);
	}

	#withIndexLock<Result>(operation: () => Promise<Result>): Promise<Result> {
		const run = this.#indexLock.then(operation, operation);
		this.#indexLock = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async #ensureLayout(): Promise<void> {
		await mkdir(this.#rootDir, { recursive: true });
	}

	#mapDir(id: string): string {
		return join(this.#rootDir, id);
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
			throw new Error(`Local Wayfinder ticket id must be <map>/<NN-slug>: ${id}`);
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
		try {
			await this.#readMapBody(id);
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
}
