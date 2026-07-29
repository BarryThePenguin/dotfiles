import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	appendDecision,
	parseMapBody,
	replaceMapSection,
	renderMapBody,
	type MapSectionKey,
} from "./map-body.ts";
import { getMetadata, removeMetadata, setMetadata } from "./metadata.ts";
import { parseTicketBody, renderTicketBody } from "./ticket-body.ts";
import type {
	DecisionSummary,
	ParsedMapBody,
	TicketType,
	WayfinderTicket,
} from "./schema.ts";

export type LocalTicketStatus = "open" | "closed";

export type LocalMap = ParsedMapBody & {
	id: string;
	title: string;
	url: string;
};

export type LocalTicket = WayfinderTicket & {
	url: string;
	status: LocalTicketStatus;
	comments: string[];
};

export type CreateLocalMapInput = {
	title: string;
	destination: string;
	notes?: string;
	notYetSpecified?: string[];
};

export type CreateLocalChildTicketInput = {
	mapId: string;
	title: string;
	type: TicketType;
	question: string;
	blockerIds?: string[];
};

export type LocalClaimResult = {
	claimed: boolean;
	ticket: LocalTicket;
};

type LocalMapRecord = {
	id: string;
	title: string;
	url: string;
	createdAt?: string;
};

type LocalTicketRecord = {
	id: string;
	mapId: string;
	title: string;
	type: TicketType;
	url: string;
	status: LocalTicketStatus;
	claimedBy?: string;
	comments: string[];
	createdAt?: string;
};

type LocalIndex = {
	maps: Record<string, LocalMapRecord>;
	tickets: Record<string, LocalTicketRecord>;
};

function emptyIndex(): LocalIndex {
	return {
		maps: {},
		tickets: {},
	};
}

function localId(prefix: "map" | "ticket"): string {
	return `${prefix}_${randomUUID()}`;
}

function numericIdPart(id: string): number | undefined {
	const match = /-(\d+)$/.exec(id);
	return match ? Number(match[1]) : undefined;
}

function compareRecordOrder(
	a: { id: string; createdAt?: string },
	b: { id: string; createdAt?: string },
): number {
	if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
		return a.createdAt.localeCompare(b.createdAt);
	}

	const numericA = numericIdPart(a.id);
	const numericB = numericIdPart(b.id);
	if (numericA !== undefined && numericB !== undefined) {
		return numericA - numericB;
	}

	return a.id.localeCompare(b.id);
}

function sortById<T extends { id: string; createdAt?: string }>(
	records: T[],
): T[] {
	return records.toSorted(compareRecordOrder);
}

export class LocalMarkdownTracker {
	readonly #rootDir: string;
	#indexLock = Promise.resolve();

	constructor(rootDir: string) {
		this.#rootDir = rootDir;
	}

	async createMap(input: CreateLocalMapInput): Promise<LocalMap> {
		return this.#withIndexLock(async () => {
			const index = await this.#loadIndex();
			const id = localId("map");

			const record: LocalMapRecord = {
				id,
				title: input.title,
				url: `local-wayfinder://map/${id}`,
				createdAt: new Date().toISOString(),
			};
			index.maps[id] = record;

			await this.#writeMapBody(
				id,
				renderMapBody({
					destination: input.destination,
					notes: input.notes ?? "",
					decisionsSoFar: [],
					notYetSpecified: input.notYetSpecified ?? [],
					outOfScope: [],
				}),
			);
			await this.#saveIndex(index);

			return this.getMap(id);
		});
	}

	async createChildTicket(
		input: CreateLocalChildTicketInput,
	): Promise<LocalTicket> {
		return this.#withIndexLock(async () => {
			const index = await this.#loadIndex();
			this.#requireMap(index, input.mapId);

			const id = localId("ticket");

			const record: LocalTicketRecord = {
				id,
				mapId: input.mapId,
				title: input.title,
				type: input.type,
				url: `local-wayfinder://ticket/${id}`,
				status: "open",
				comments: [],
				createdAt: new Date().toISOString(),
			};
			index.tickets[id] = record;

			await this.#writeTicketBody(
				id,
				renderTicketBody({
					question: input.question,
					mapId: input.mapId,
					blockerIds: input.blockerIds ?? [],
				}),
			);
			await this.#saveIndex(index);

			return this.getTicket(id);
		});
	}

	async getMap(id: string): Promise<LocalMap> {
		const index = await this.#loadIndex();
		const record = this.#requireMap(index, id);
		const body = await this.#readMapBody(id);
		return {
			...record,
			...parseMapBody(body),
		};
	}

	async getTicket(id: string): Promise<LocalTicket> {
		const index = await this.#loadIndex();
		const record = this.#requireTicket(index, id);
		const body = await this.#readTicketBody(id);
		const parsed = parseTicketBody(body);
		return {
			id: record.id,
			mapId: parsed.mapId ?? record.mapId,
			title: record.title,
			type: record.type,
			question: parsed.question,
			blockerIds: parsed.blockerIds,
			...(parsed.claimedBy ? { claimedBy: parsed.claimedBy } : {}),
			url: record.url,
			status: record.status,
			comments: record.comments,
		};
	}

	async listMaps(): Promise<LocalMap[]> {
		const index = await this.#loadIndex();
		const records = sortById(Object.values(index.maps));
		return Promise.all(records.map((record) => this.getMap(record.id)));
	}

	async listTickets(): Promise<LocalTicket[]> {
		const index = await this.#loadIndex();
		const records = sortById(Object.values(index.tickets));
		return Promise.all(records.map((record) => this.getTicket(record.id)));
	}

	async listChildTickets(mapId: string): Promise<LocalTicket[]> {
		const index = await this.#loadIndex();
		this.#requireMap(index, mapId);
		const records = sortById(
			Object.values(index.tickets).filter((ticket) => ticket.mapId === mapId),
		);
		return Promise.all(records.map((record) => this.getTicket(record.id)));
	}

	async listFrontierTickets(mapId: string): Promise<LocalTicket[]> {
		const tickets = await this.listChildTickets(mapId);
		const frontier: LocalTicket[] = [];

		for (const ticket of tickets) {
			if (ticket.status !== "open" || ticket.claimedBy) {
				continue;
			}

			const blockers = await Promise.all(
				ticket.blockerIds.map((blockerId) => this.getTicket(blockerId)),
			);
			if (blockers.every((blocker) => blocker.status === "closed")) {
				frontier.push(ticket);
			}
		}

		return frontier;
	}

	async claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<LocalClaimResult> {
		return this.#withIndexLock(async () => {
			const index = await this.#loadIndex();
			const record = this.#requireTicket(index, id);
			const ticket = await this.getTicket(id);

			if (ticket.status !== "open" || ticket.claimedBy) {
				return { claimed: false, ticket };
			}

			record.claimedBy = claimant;
			await this.#writeTicketBody(
				id,
				setMetadata(await this.#readTicketBody(id), "claimed-by", [claimant]),
			);
			await this.#saveIndex(index);

			return { claimed: true, ticket: await this.getTicket(id) };
		});
	}

	async updateMapBody(id: string, body: string): Promise<LocalMap> {
		const index = await this.#loadIndex();
		this.#requireMap(index, id);
		await this.#writeMapBody(id, body);
		return this.getMap(id);
	}

	async updateTicketBody(id: string, body: string): Promise<LocalTicket> {
		const index = await this.#loadIndex();
		this.#requireTicket(index, id);
		await this.#writeTicketBody(id, body);
		return this.getTicket(id);
	}

	async unclaimTicket(id: string): Promise<LocalTicket> {
		return this.#withIndexLock(async () => {
			const index = await this.#loadIndex();
			const record = this.#requireTicket(index, id);
			delete record.claimedBy;
			await this.#writeTicketBody(
				id,
				removeMetadata(await this.#readTicketBody(id), "claimed-by"),
			);
			await this.#saveIndex(index);
			return this.getTicket(id);
		});
	}

	async closeTicket(id: string): Promise<LocalTicket> {
		return this.#withIndexLock(async () => {
			const index = await this.#loadIndex();
			const record = this.#requireTicket(index, id);
			record.status = "closed";
			await this.#saveIndex(index);
			return this.getTicket(id);
		});
	}

	async postComment(id: string, body: string): Promise<void> {
		return this.#withIndexLock(async () => {
			const index = await this.#loadIndex();
			const record = this.#requireTicket(index, id);
			record.comments.push(body);
			await this.#saveIndex(index);
		});
	}

	async setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<LocalTicket> {
		const index = await this.#loadIndex();
		this.#requireTicket(index, id);
		for (const blockerId of blockerIds) {
			this.#requireTicket(index, blockerId);
		}

		await this.#writeTicketBody(
			id,
			setMetadata(await this.#readTicketBody(id), "blocked-by", blockerIds),
		);
		return this.getTicket(id);
	}

	async addBlockingDependency(
		id: string,
		blockerId: string,
	): Promise<LocalTicket> {
		const body = await this.#readTicketBody(id);
		const blockerIds = new Set(getMetadata(body, "blocked-by"));
		blockerIds.add(blockerId);
		return this.setBlockingDependencies(id, Array.from(blockerIds));
	}

	async recordDecision(
		mapId: string,
		decision: DecisionSummary,
	): Promise<LocalMap> {
		const index = await this.#loadIndex();
		this.#requireMap(index, mapId);
		await this.#writeMapBody(
			mapId,
			appendDecision(await this.#readMapBody(mapId), decision),
		);
		return this.getMap(mapId);
	}

	async updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<LocalMap> {
		const index = await this.#loadIndex();
		this.#requireMap(index, mapId);
		await this.#writeMapBody(
			mapId,
			replaceMapSection(await this.#readMapBody(mapId), section, content),
		);
		return this.getMap(mapId);
	}

	async #ensureLayout(): Promise<void> {
		await mkdir(this.#mapsDir(), { recursive: true });
		await mkdir(this.#ticketsDir(), { recursive: true });
	}

	#withIndexLock<Result>(operation: () => Promise<Result>): Promise<Result> {
		const run = this.#indexLock.then(operation, operation);
		this.#indexLock = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async #loadIndex(): Promise<LocalIndex> {
		await this.#ensureLayout();
		try {
			return JSON.parse(
				await readFile(this.#indexPath(), "utf8"),
			) as LocalIndex;
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				const index = emptyIndex();
				await this.#saveIndex(index);
				return index;
			}
			throw error;
		}
	}

	async #saveIndex(index: LocalIndex): Promise<void> {
		await this.#ensureLayout();
		await writeFile(
			this.#indexPath(),
			`${JSON.stringify(index, null, "\t")}\n`,
		);
	}

	#requireMap(index: LocalIndex, id: string): LocalMapRecord {
		const map = index.maps[id];
		if (!map) {
			throw new Error(`Wayfinder map not found: ${id}`);
		}
		return map;
	}

	#requireTicket(index: LocalIndex, id: string): LocalTicketRecord {
		const ticket = index.tickets[id];
		if (!ticket) {
			throw new Error(`Wayfinder ticket not found: ${id}`);
		}
		return ticket;
	}

	#mapsDir(): string {
		return join(this.#rootDir, "maps");
	}

	#ticketsDir(): string {
		return join(this.#rootDir, "tickets");
	}

	#indexPath(): string {
		return join(this.#rootDir, "index.json");
	}

	#mapPath(id: string): string {
		return join(this.#mapsDir(), `${id}.md`);
	}

	#ticketPath(id: string): string {
		return join(this.#ticketsDir(), `${id}.md`);
	}

	async #readMapBody(id: string): Promise<string> {
		return readFile(this.#mapPath(id), "utf8");
	}

	async #writeMapBody(id: string, body: string): Promise<void> {
		await this.#ensureLayout();
		await writeFile(this.#mapPath(id), body);
	}

	async #readTicketBody(id: string): Promise<string> {
		return readFile(this.#ticketPath(id), "utf8");
	}

	async #writeTicketBody(id: string, body: string): Promise<void> {
		await this.#ensureLayout();
		await writeFile(this.#ticketPath(id), body);
	}
}
