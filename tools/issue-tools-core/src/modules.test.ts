import { describe, expect, it } from "vitest";
import type { Issue } from "./issue.ts";
import {
	createTrackerModules,
	IssueModule,
	WayfinderModule,
	type IssuePersistence,
	type TrackerPersistence,
	type WayfinderPersistence,
} from "./modules.ts";
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
			createIssue: () => Promise.resolve(issue),
			readIssue: () => Promise.resolve(issue),
			updateIssueLabels: () => Promise.resolve(issue),
			commentOnIssue: () =>
				Promise.resolve({ comment: { content: "comment" } }),
			closeIssue: () => Promise.resolve({ status: "closed" }),
			listIssues: () => Promise.resolve([issue]),
		};
		const module = new IssueModule(persistence);

		expect(await module.createIssue({ title: issue.title })).toEqual(issue);
		expect(await module.readIssue(issue.id)).toEqual(issue);
		expect(await module.listIssues({})).toEqual([issue]);
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
			listFrontierTickets: () => Promise.resolve([ticket]),
			claimTicketIfUnclaimed: () => Promise.resolve({ claimed: true, ticket }),
			unclaimTicket: () => Promise.resolve(ticket),
			closeTicket: () => Promise.resolve({ ...ticket, status: "closed" }),
			resolveTicket: () => Promise.resolve({ ...ticket, status: "closed" }),
			setBlockingDependencies: () => Promise.resolve(ticket),
			addBlockingDependency: () => Promise.resolve(ticket),
			recordDecision: () => Promise.resolve(map),
			updateMapSection: () => Promise.resolve(map),
		};
		const module = new WayfinderModule(persistence);

		expect(
			await module.createMap({ title: map.title, destination: "" }),
		).toEqual(map);
		expect(await module.getTicket(ticket.id)).toEqual(ticket);
		expect(await module.listFrontierTickets(map.id)).toEqual([ticket]);
	});
});

describe("createTrackerModules", () => {
	it("exposes separate modules over one shared persistence adapter", () => {
		const unused = () => Promise.reject(new Error("not used"));
		const persistence = {
			createIssue: unused,
			readIssue: unused,
			updateIssueLabels: unused,
			commentOnIssue: unused,
			closeIssue: unused,
			listIssues: unused,
			createMap: unused,
			listMaps: unused,
			createChildTicket: unused,
			getMap: unused,
			getTicket: unused,
			listChildTickets: unused,
			listFrontierTickets: unused,
			claimTicketIfUnclaimed: unused,
			unclaimTicket: unused,
			closeTicket: unused,
			resolveTicket: unused,
			setBlockingDependencies: unused,
			addBlockingDependency: unused,
			recordDecision: unused,
			updateMapSection: unused,
		} satisfies TrackerPersistence;
		const modules = createTrackerModules(persistence);

		expect(modules.issues).toHaveProperty("createIssue");
		expect(modules.issues).not.toHaveProperty("createMap");
		expect(modules.wayfinder).toHaveProperty("createMap");
		expect(modules.wayfinder).not.toHaveProperty("createIssue");
	});
});
