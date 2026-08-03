import { describe, expect, it, vi } from "vitest";
import type { CreateIssueInput, Issue } from "./issue.ts";
import {
	createTrackerModules,
	IssueModule,
	WayfinderModule,
	type IssuePersistence,
	type TrackerPersistence,
	type WayfinderPersistence,
} from "./modules.ts";
import { parseMapBody, renderMapBody } from "./map-body.ts";
import {
	BlockerNotOnMapError,
	ClosedTicketWithoutResolutionError,
	type WayfinderTrackerMap,
	type WayfinderTrackerTicket,
} from "./tracker.ts";

describe("IssueModule", () => {
	it("can be constructed from an Issue persistence capability", async () => {
		const issue: Issue = {
			id: "issue-1",
			url: "issue-1.md",
			title: "An issue",
			body: "",
			labels: [],
			status: "open",
			comments: [],
		};
		const persistence: IssuePersistence = {
			createIssueRecord: () => Promise.resolve(issue),
			readIssueRecord: () => Promise.resolve(issue),
			writeIssueLabels: () => Promise.resolve(issue),
			appendIssueComment: () =>
				Promise.resolve({ comment: { content: "comment" } }),
			closeIssueRecord: () => Promise.resolve({ status: "closed" }),
			listIssueRecords: () => Promise.resolve([issue]),
		};
		const module = new IssueModule(persistence);

		expect(await module.createIssue({ title: issue.title })).toEqual(issue);
		expect(await module.readIssue(issue.id)).toEqual(issue);
		expect(await module.listIssues({})).toEqual([issue]);
	});

	it("owns label deltas, comments, closing, and list filtering", async () => {
		const first: Issue = {
			id: "issue-1",
			url: "issue-1.md",
			title: "First issue",
			body: "",
			labels: ["needs-triage", "bug"],
			status: "open",
			comments: [],
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		const second: Issue = {
			...first,
			id: "issue-2",
			url: "issue-2.md",
			title: "Second issue",
			labels: [],
			createdAt: "2026-01-02T00:00:00.000Z",
		};
		let records = [first, second];
		const recordOrThrow = (id: string): Issue => {
			const record = records.find((item) => item.id === id);
			if (!record) {
				throw new Error(`Missing issue: ${id}`);
			}
			return record;
		};
		const persistence: IssuePersistence = {
			createIssueRecord: vi.fn((input: CreateIssueInput) => {
				const created: Issue = {
					...first,
					...input,
					labels: input.labels ?? [],
					id: "created",
					url: "created.md",
				};
				records.push(created);
				return Promise.resolve(created);
			}),
			readIssueRecord: vi.fn((id: string) =>
				Promise.resolve(recordOrThrow(id)),
			),
			writeIssueLabels: vi.fn((id: string, labels: string[]) => {
				records = records.map((record) =>
					record.id === id ? { ...record, labels } : record,
				);
				return Promise.resolve(recordOrThrow(id));
			}),
			appendIssueComment: vi.fn((id: string, content: string) => {
				records = records.map((record) =>
					record.id === id
						? { ...record, comments: [...record.comments, { content }] }
						: record,
				);
				return Promise.resolve({ comment: { content } });
			}),
			closeIssueRecord: vi.fn((id: string, options?: { comment?: string }) => {
				records = records.map((record) =>
					record.id === id
						? {
								...record,
								status: "closed",
								comments: options?.comment
									? [...record.comments, { content: options.comment }]
									: record.comments,
							}
						: record,
				);
				return Promise.resolve({ status: "closed" as const });
			}),
			listIssueRecords: vi.fn(() => Promise.resolve(records)),
		};
		const module = new IssueModule(persistence);

		await module.createIssue({ title: "Created without labels" });
		expect(persistence.createIssueRecord).toHaveBeenCalledWith({
			title: "Created without labels",
			labels: [],
		});
		await module.updateIssueLabels(first.id, {
			add: ["home", "bug"],
			remove: ["needs-triage", "home"],
		});
		expect((await module.readIssue(first.id)).labels).toEqual(["bug"]);
		await module.commentOnIssue(first.id, "Agent note");
		await module.closeIssue(first.id, { comment: "Done" });
		expect(
			(await module.readIssue(first.id)).comments.map(
				(comment) => comment.content,
			),
		).toEqual(["Agent note", "Done"]);
		expect(await module.listIssues({ state: "closed" })).toHaveLength(1);
		expect(
			(await module.listIssues({ unlabeled: true })).map((item) => item.id),
		).toEqual(["created", second.id]);
	});
});

describe("WayfinderModule", () => {
	it("can be constructed from a Wayfinder persistence capability", async () => {
		const map: WayfinderTrackerMap = {
			id: "map",
			title: "A map",
			url: "map.md",
			destination: "",
			notes: "",
			decisionsSoFar: [],
			notYetSpecified: [],
			outOfScope: [],
		};
		const ticket: WayfinderTrackerTicket = {
			id: "map/01-ticket",
			mapId: map.id,
			title: "A ticket",
			type: "task",
			question: "What should we do?",
			blockerIds: [],
			url: "map/01-ticket.md",
			status: "open",
			comments: [],
		};
		const persistence: WayfinderPersistence = {
			createMap: () => Promise.resolve(map),
			listMaps: () => Promise.resolve([map]),
			createChildTicket: () => Promise.resolve(ticket),
			getMap: () => Promise.resolve(map),
			getTicket: () => Promise.resolve(ticket),
			listChildTickets: () => Promise.resolve([ticket]),
			writeMapDecisions: () => Promise.resolve(map),
			writeMapSection: () => Promise.resolve(map),
			claimTicketIfUnclaimed: () => Promise.resolve({ claimed: true, ticket }),
			unclaimTicket: () => Promise.resolve(ticket),
			closeTicket: () => Promise.resolve({ ...ticket, status: "closed" }),
			recordResolution: () => Promise.resolve({ ...ticket, status: "closed" }),
			setBlockingDependencies: () => Promise.resolve(ticket),
		};
		const module = new WayfinderModule(persistence);

		expect(
			await module.createMap({ title: map.title, destination: "" }),
		).toEqual(map);
		expect(await module.getTicket(ticket.id)).toEqual(ticket);
		expect((await module.inspectFrontier(map.id)).frontier).toEqual([ticket]);
	});

	it("owns frontier, claim, blocker, and map document behavior", async () => {
		const mapShape = {
			id: "map",
			title: "A map",
			url: "map.md",
		};
		let mapBody = renderMapBody({
			destination: "Destination",
			notes: "Notes",
			decisionsSoFar: [],
			notYetSpecified: [],
			outOfScope: [],
		});
		const map = (): WayfinderTrackerMap => ({
			...mapShape,
			...parseMapBody(mapBody),
		});
		const blocker: WayfinderTrackerTicket = {
			id: "map/01-blocker",
			mapId: "map",
			title: "Blocker",
			type: "research",
			question: "What blocks the work?",
			blockerIds: [],
			url: "issues/01-blocker.md",
			status: "open",
			comments: [],
		};
		const blocked: WayfinderTrackerTicket = {
			...blocker,
			id: "map/02-blocked",
			title: "Blocked",
			blockerIds: [blocker.id],
		};
		let currentTickets = [blocker, blocked];
		const ticketOrThrow = (id: string): WayfinderTrackerTicket => {
			const ticket = currentTickets.find((item) => item.id === id);
			if (!ticket) {
				throw new Error(`Missing ticket: ${id}`);
			}
			return ticket;
		};
		const claim = vi.fn((id: string, claimant: string) => {
			currentTickets = currentTickets.map((current) =>
				current.id === id ? { ...current, claimedBy: claimant } : current,
			);
			return Promise.resolve({ claimed: true, ticket: ticketOrThrow(id) });
		});
		const setBlocking = vi.fn((id: string, blockerIds: string[]) => {
			currentTickets = currentTickets.map((current) =>
				current.id === id ? { ...current, blockerIds } : current,
			);
			return Promise.resolve(ticketOrThrow(id));
		});
		const persistence: WayfinderPersistence = {
			createMap: () => Promise.resolve(map()),
			listMaps: () => Promise.resolve([map()]),
			createChildTicket: () => Promise.resolve(blocker),
			getMap: () => Promise.resolve(map()),
			getTicket: (id) => Promise.resolve(ticketOrThrow(id)),
			listChildTickets: () => Promise.resolve(currentTickets),
			writeMapDecisions: (_id, decisions) => {
				const current = parseMapBody(mapBody);
				mapBody = renderMapBody({ ...current, decisionsSoFar: decisions });
				return Promise.resolve(map());
			},
			writeMapSection: (_id, section, content) => {
				const current = parseMapBody(mapBody);
				mapBody = renderMapBody({
					...current,
					...(section === "notes" ? { notes: content } : {}),
				});
				return Promise.resolve(map());
			},
			claimTicketIfUnclaimed: claim,
			unclaimTicket: () => Promise.resolve(blocker),
			closeTicket: () => Promise.resolve(blocker),
			recordResolution: () => Promise.resolve({ ...blocker, status: "closed" }),
			setBlockingDependencies: setBlocking,
		};
		const module = new WayfinderModule(persistence);

		expect((await module.inspectFrontier(mapShape.id)).frontier).toEqual([
			blocker,
		]);
		expect(
			await module.claimTicketIfUnclaimed(blocker.id, "agent-1"),
		).toMatchObject({
			claimed: true,
			ticket: { claimedBy: "agent-1" },
		});
		expect(claim).toHaveBeenCalledWith(blocker.id, "agent-1");
		await module.addBlockingDependency(blocker.id, blocked.id);
		expect(setBlocking).toHaveBeenCalledWith(blocker.id, [blocked.id]);

		await module.updateMapSection(mapShape.id, "notes", "Updated notes");
		expect((await module.getMap(mapShape.id)).notes).toBe("Updated notes");
		await module.recordDecision(mapShape.id, {
			title: blocker.title,
			url: blocker.url,
			gist: "The blocker is the first decision.",
		});
		expect((await module.getMap(mapShape.id)).decisionsSoFar).toEqual([
			{
				title: blocker.title,
				url: blocker.url,
				gist: "The blocker is the first decision.",
			},
		]);
	});
});

describe("WayfinderModule inspectFrontier", () => {
	function makeFixture() {
		const map: WayfinderTrackerMap = {
			id: "map",
			title: "A map",
			url: "map.md",
			destination: "",
			notes: "",
			decisionsSoFar: [],
			notYetSpecified: [],
			outOfScope: [],
		};
		const base = (
			overrides: Partial<WayfinderTrackerTicket>,
		): WayfinderTrackerTicket => ({
			id: "map/01",
			mapId: "map",
			title: "Ticket",
			type: "task",
			question: "Question",
			blockerIds: [],
			url: "issues/01.md",
			status: "open",
			comments: [],
			...overrides,
		});
		const frontierTicket = base({ id: "map/01-frontier", title: "Frontier" });
		const blockerC = base({ id: "map/01-blocker-c", title: "Blocker C" });
		const blockerA = base({
			id: "map/01-blocker-a",
			title: "Blocker A",
			blockerIds: [blockerC.id],
		});
		const blockerB = base({
			id: "map/01-blocker-b",
			title: "Blocker B",
			status: "closed",
		});
		const blockedTicket = base({
			id: "map/02-blocked",
			title: "Blocked",
			blockerIds: [blockerA.id, blockerB.id],
		});
		const claimedTicket = base({
			id: "map/03-claimed",
			title: "Claimed",
			claimedBy: "agent-1",
			blockerIds: [blockerA.id],
		});
		const closedTicket = base({
			id: "map/04-closed",
			title: "Closed",
			status: "closed",
		});
		const allTickets = [
			frontierTicket,
			blockedTicket,
			blockerA,
			blockerB,
			blockerC,
			claimedTicket,
			closedTicket,
		];
		const ticketOrThrow = (id: string): WayfinderTrackerTicket => {
			const ticket = allTickets.find((item) => item.id === id);
			if (!ticket) {
				throw new Error(`Missing ticket: ${id}`);
			}
			return ticket;
		};
		const getTicket = vi.fn((id: string) =>
			Promise.resolve(ticketOrThrow(id)),
		);
		const listChildTickets = vi.fn(() => Promise.resolve(allTickets));
		const setBlockingDependencies = vi.fn(() =>
			Promise.resolve(blockedTicket),
		);
		const persistence: WayfinderPersistence = {
			createMap: () => Promise.resolve(map),
			listMaps: () => Promise.resolve([map]),
			createChildTicket: () => Promise.resolve(frontierTicket),
			getMap: () => Promise.resolve(map),
			getTicket,
			listChildTickets,
			writeMapDecisions: () => Promise.resolve(map),
			writeMapSection: () => Promise.resolve(map),
			claimTicketIfUnclaimed: () =>
				Promise.resolve({ claimed: true, ticket: claimedTicket }),
			unclaimTicket: () => Promise.resolve(claimedTicket),
			closeTicket: () => Promise.resolve(blockerA),
			recordResolution: () => Promise.resolve(blockerA),
			setBlockingDependencies,
		};
		return {
			module: new WayfinderModule(persistence),
			getTicket,
			listChildTickets,
			setBlockingDependencies,
		};
	}

	it("partitions open tickets into frontier, blocked, and claimed", async () => {
		const { module } = makeFixture();
		const inspection = await module.inspectFrontier("map");

		expect(inspection.frontier.map((ticket) => ticket.id)).toEqual([
			"map/01-frontier",
			"map/01-blocker-c",
		]);
		expect(inspection.blocked).toEqual([
			{
				ticket: expect.objectContaining({ id: "map/02-blocked" }),
				blockers: ["map/01-blocker-a"],
			},
			{
				ticket: expect.objectContaining({ id: "map/01-blocker-a" }),
				blockers: ["map/01-blocker-c"],
			},
		]);
		expect(inspection.claimed.map((ticket) => ticket.id)).toEqual([
			"map/03-claimed",
		]);
	});

	it("classifies the frontier from a single sibling read", async () => {
		const { module, getTicket, listChildTickets } = makeFixture();
		await module.inspectFrontier("map");

		// Blocker statuses derive from the sibling list, so the frontier needs
		// one storage call and no per-blocker reads.
		expect(listChildTickets).toHaveBeenCalledTimes(1);
		expect(getTicket).not.toHaveBeenCalled();
	});

	it("rejects a blocker that is not on the ticket's map", async () => {
		const { module, setBlockingDependencies } = makeFixture();
		await expect(
			module.setBlockingDependencies("map/01-frontier", ["other-map/01"]),
		).rejects.toBeInstanceOf(BlockerNotOnMapError);
		expect(setBlockingDependencies).not.toHaveBeenCalled();
	});

	it("rejects a foreign blocker when creating a child ticket", async () => {
		const { module } = makeFixture();
		await expect(
			module.createChildTicket({
				mapId: "map",
				title: "A ticket",
				type: "task",
				question: "Question",
				blockerIds: ["map/01-frontier", "other-map/01"],
			}),
		).rejects.toBeInstanceOf(BlockerNotOnMapError);
	});

	it("routes addBlockingDependency through the same-map check", async () => {
		const { module } = makeFixture();
		await expect(
			module.addBlockingDependency("map/01-frontier", "other-map/01"),
		).rejects.toBeInstanceOf(BlockerNotOnMapError);
	});

	it("accepts same-map blockers and passes them through", async () => {
		const { module, setBlockingDependencies } = makeFixture();
		await module.setBlockingDependencies("map/01-frontier", [
			"map/02-blocked",
		]);
		expect(setBlockingDependencies).toHaveBeenCalledWith("map/01-frontier", [
			"map/02-blocked",
		]);
	});

	it("clears blocking without a map validation read", async () => {
		const { module, listChildTickets, setBlockingDependencies } =
			makeFixture();
		await module.setBlockingDependencies("map/01-frontier", []);
		expect(listChildTickets).not.toHaveBeenCalled();
		expect(setBlockingDependencies).toHaveBeenCalledWith("map/01-frontier", []);
	});
});

describe("WayfinderModule resolveTicket workflow", () => {
	const mapShape = {
		id: "map",
		title: "A map",
		url: "map.md",
	};

	function makeFixture(options?: { failMapWrite?: boolean }) {
		let mapBody = renderMapBody({
			destination: "Destination",
			notes: "Notes",
			decisionsSoFar: [],
			notYetSpecified: [],
			outOfScope: [],
		});
		const map = (): WayfinderTrackerMap => ({
			...mapShape,
			...parseMapBody(mapBody),
		});
		const blocker: WayfinderTrackerTicket = {
			id: "map/01-blocker",
			mapId: "map",
			title: "Blocker",
			type: "grilling",
			question: "Which path should we take?",
			blockerIds: [],
			url: "issues/01-blocker.md",
			status: "open",
			comments: [],
		};
		const blocked: WayfinderTrackerTicket = {
			...blocker,
			id: "map/02-blocked",
			title: "Blocked",
			blockerIds: [blocker.id],
		};
		let currentTickets = [blocker, blocked];
		const ticketOrThrow = (id: string): WayfinderTrackerTicket => {
			const ticket = currentTickets.find((item) => item.id === id);
			if (!ticket) {
				throw new Error(`Missing ticket: ${id}`);
			}
			return ticket;
		};
		const persistence: WayfinderPersistence = {
			createMap: () => Promise.resolve(map()),
			listMaps: () => Promise.resolve([map()]),
			createChildTicket: () => Promise.resolve(blocker),
			getMap: () => Promise.resolve(map()),
			getTicket: (id) => Promise.resolve(ticketOrThrow(id)),
			listChildTickets: () => Promise.resolve(currentTickets),
			writeMapDecisions: options?.failMapWrite
				? () => Promise.reject(new Error("map write failed"))
				: (_id, decisions) => {
						const current = parseMapBody(mapBody);
						mapBody = renderMapBody({ ...current, decisionsSoFar: decisions });
						return Promise.resolve(map());
					},
			writeMapSection: (_id, section, content) => {
				const current = parseMapBody(mapBody);
				mapBody = renderMapBody({
					...current,
					...(section === "notes" ? { notes: content } : {}),
				});
				return Promise.resolve(map());
			},
			claimTicketIfUnclaimed: () =>
				Promise.resolve({ claimed: true, ticket: blocker }),
			unclaimTicket: () => Promise.resolve(blocker),
			closeTicket: (id) => {
				currentTickets = currentTickets.map((current) =>
					current.id === id ? { ...current, status: "closed" } : current,
				);
				return Promise.resolve(ticketOrThrow(id));
			},
			recordResolution: (id, resolution) => {
				const current = ticketOrThrow(id);
				if (current.status === "closed") {
					return Promise.reject(new ClosedTicketWithoutResolutionError(id));
				}
				currentTickets = currentTickets.map((ticket) =>
					ticket.id === id
						? { ...ticket, status: "closed", comments: [resolution] }
						: ticket,
				);
				return Promise.resolve(ticketOrThrow(id));
			},
			setBlockingDependencies: () => Promise.resolve(blocker),
		};
		return { module: new WayfinderModule(persistence), map: map(), blocked };
	}

	it("resolves, records the decision, and reports unblocked tickets", async () => {
		const { module, map, blocked } = makeFixture();
		const result = await module.resolveTicket({
			ticketId: "map/01-blocker",
			mapId: map.id,
			resolution: "Resolved.",
			gist: "Take the simplest path.",
		});

		expect(result.outcome).toBe("complete");
		expect(result.resolutionPosted).toBe(true);
		expect(result.decisionRecorded).toBe(true);
		expect(result.resolvedTicket).toMatchObject({
			id: "map/01-blocker",
			status: "closed",
			comments: ["Resolved."],
		});
		expect(result.map?.decisionsSoFar).toEqual([
			{
				title: "Blocker",
				url: "issues/01-blocker.md",
				gist: "Take the simplest path.",
			},
		]);
		expect(result.unblocked).toEqual([blocked.id]);
	});

	it("returns a retryable partial result when the map write fails", async () => {
		const { module, map, blocked } = makeFixture({ failMapWrite: true });
		const result = await module.resolveTicket({
			ticketId: "map/01-blocker",
			mapId: map.id,
			resolution: "Resolved.",
			gist: "Take the simplest path.",
		});

		expect(result).toMatchObject({
			outcome: "partial",
			decisionRecorded: false,
			resolutionPosted: true,
			unblocked: [blocked.id],
			resolvedTicket: { status: "closed" },
		});
		expect(result.error).toContain("map write failed");
	});

	it("returns a terminal result for a closed ticket without a Resolution", async () => {
		const { module, map } = makeFixture();
		await module.closeTicket("map/01-blocker");
		const result = await module.resolveTicket({
			ticketId: "map/01-blocker",
			mapId: map.id,
			resolution: "Too late.",
			gist: "Inspect the incomplete ticket.",
		});

		expect(result).toMatchObject({
			outcome: "terminal",
			resolutionPosted: false,
			decisionRecorded: false,
			resolvedTicket: { status: "closed" },
		});
		expect(result.error).toMatch(/closed without/i);
	});

	it("rejects a mismatched map identity before touching the adapter", async () => {
		const { module } = makeFixture();
		await expect(
			module.resolveTicket({
				ticketId: "map/01-blocker",
				mapId: "other-map",
				resolution: "Resolved.",
				gist: "Take the simplest path.",
			}),
		).rejects.toThrow(/map identity/i);

		expect((await module.getTicket("map/01-blocker")).status).toBe("open");
	});
});

describe("createTrackerModules", () => {
	it("exposes separate modules over one shared persistence adapter", () => {
		const unused = () => Promise.reject(new Error("not used"));
		const persistence = {
			createIssueRecord: unused,
			readIssueRecord: unused,
			writeIssueLabels: unused,
			appendIssueComment: unused,
			closeIssueRecord: unused,
			listIssueRecords: unused,
			createMap: unused,
			listMaps: unused,
			createChildTicket: unused,
			getMap: unused,
			getTicket: unused,
			listChildTickets: unused,
			writeMapDecisions: unused,
			writeMapSection: unused,
			claimTicketIfUnclaimed: unused,
			unclaimTicket: unused,
			closeTicket: unused,
			recordResolution: unused,
			setBlockingDependencies: unused,
		} satisfies TrackerPersistence;
		const modules = createTrackerModules(persistence);

		expect(modules.issues).toHaveProperty("createIssue");
		expect(modules.issues).not.toHaveProperty("createMap");
		expect(modules.wayfinder).toHaveProperty("createMap");
		expect(modules.wayfinder).not.toHaveProperty("createIssue");
	});
});
