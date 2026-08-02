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
import type { WayfinderTrackerMap, WayfinderTrackerTicket } from "./tracker.ts";

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
			resolveTicket: () => Promise.resolve({ ...ticket, status: "closed" }),
			setBlockingDependencies: () => Promise.resolve(ticket),
		};
		const module = new WayfinderModule(persistence);

		expect(
			await module.createMap({ title: map.title, destination: "" }),
		).toEqual(map);
		expect(await module.getTicket(ticket.id)).toEqual(ticket);
		expect(await module.listFrontierTickets(map.id)).toEqual([ticket]);
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
			resolveTicket: () => Promise.resolve({ ...blocker, status: "closed" }),
			setBlockingDependencies: setBlocking,
		};
		const module = new WayfinderModule(persistence);

		expect(await module.listFrontierTickets(mapShape.id)).toEqual([blocker]);
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
			resolveTicket: unused,
			setBlockingDependencies: unused,
		} satisfies TrackerPersistence;
		const modules = createTrackerModules(persistence);

		expect(modules.issues).toHaveProperty("createIssue");
		expect(modules.issues).not.toHaveProperty("createMap");
		expect(modules.wayfinder).toHaveProperty("createMap");
		expect(modules.wayfinder).not.toHaveProperty("createIssue");
	});
});
