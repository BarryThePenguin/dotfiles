import { describe, expect, it } from "vitest";
import { handleAction, type ActionMap, type ActionRuntime } from "./actions.ts";
import type { IssueTracker, WayfinderTracker } from "./index.ts";
import {
	makeFakeIssueTracker,
	makeFakeWayfinderTracker,
	makeComment,
	makeIssue,
	makeMap,
	makeTicket,
} from "./test-helpers/trackers.ts";

// ---------------------------------------------------------------------------
// Runtime factory — captures success/error calls for assertion
// ---------------------------------------------------------------------------

type CapturedResult = { text: string; details: Record<string, unknown> };

function makeRuntime(opts: {
	wayfinder?: WayfinderTracker;
	issues?: IssueTracker;
	activeMap?: string | null;
}): ActionRuntime<CapturedResult> & { activeMap: string | null } {
	let activeMap = opts.activeMap ?? null;
	return {
		get activeMap() {
			return activeMap;
		},
		wayfinder: opts.wayfinder ?? makeFakeWayfinderTracker(),
		issues: opts.issues ?? makeFakeIssueTracker(),
		requireMapId: (params) => params.map_id ?? activeMap,
		getActiveMap: () => activeMap,
		setActiveMap: (id) => {
			activeMap = id;
		},
		claimant: () => "test-user",
		success: (text, details = {}) => ({ text, details }),
		error: (msg) => ({ text: `Error: ${msg}`, details: {} }),
	};
}

function act<K extends keyof ActionMap>(
	action: K,
	params: ActionMap[K],
	runtime: ActionRuntime<CapturedResult>,
): Promise<CapturedResult> {
	return handleAction(action, params, runtime);
}

// ---------------------------------------------------------------------------
// list_maps
// ---------------------------------------------------------------------------

describe("list_maps", () => {
	it("returns empty message when no maps", async () => {
		const rt = makeRuntime({});
		const result = await act("list_maps", {}, rt);
		expect(result.text).toBe("No open wayfinder maps.");
		expect(result.details).toMatchObject({ maps: [] });
	});

	it("lists maps with title and url", async () => {
		const wayfinder = makeFakeWayfinderTracker({
			listMaps: () =>
				Promise.resolve([
					makeMap({ id: "m1", title: "Wayfinder: Alpha", url: "https://x/m1" }),
					makeMap({ id: "m2", title: "Wayfinder: Beta", url: "https://x/m2" }),
				]),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act("list_maps", {}, rt);
		expect(result.text).toContain("Alpha (m1)");
		expect(result.text).toContain("Beta (m2)");
		expect(result.details).toMatchObject({
			maps: [{ id: "m1" }, { id: "m2" }],
		});
	});

	it("auto-selects the active map when exactly one map exists", async () => {
		const wayfinder = makeFakeWayfinderTracker({
			listMaps: () => Promise.resolve([makeMap({ id: "solo" })]),
		});
		const rt = makeRuntime({ wayfinder });
		await act("list_maps", {}, rt);
		expect(rt.activeMap).toBe("solo");
	});
});

// ---------------------------------------------------------------------------
// chart
// ---------------------------------------------------------------------------

describe("chart", () => {
	it("creates map and sets active", async () => {
		const created = makeMap({ id: "new-map", title: "Wayfinder: New" });
		const wayfinder = makeFakeWayfinderTracker({
			createMap: () => Promise.resolve(created),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act(
			"chart",
			{ title: "New", destination: "Ship the feature" },
			rt,
		);
		expect(result.text).toContain("Map created:");
		expect(result.details).toMatchObject({ id: "new-map" });
		expect(rt.activeMap).toBe("new-map");
	});
});

// ---------------------------------------------------------------------------
// get_map
// ---------------------------------------------------------------------------

describe("get_map", () => {
	it("returns error when no map_id and no active map", async () => {
		const rt = makeRuntime({});
		const result = await act("get_map", {}, rt);
		expect(result.text).toMatch(/Error:/);
	});

	it("fetches map detail and sets active map", async () => {
		const map = makeMap({ id: "m1", title: "Wayfinder: Detail" });
		const wayfinder = makeFakeWayfinderTracker({
			getMapDetail: () =>
				Promise.resolve({
					map,
					frontier: [],
					blocked: [],
					claimed: [],
					openCount: 0,
					closedCount: 0,
				}),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act("get_map", { map_id: "m1" }, rt);
		expect(result.details).toMatchObject({ id: "m1" });
		expect(rt.activeMap).toBe("m1");
	});
});

// ---------------------------------------------------------------------------
// create_ticket
// ---------------------------------------------------------------------------

describe("create_ticket", () => {
	it("returns error when no map_id and no active map", async () => {
		const rt = makeRuntime({});
		const result = await act(
			"create_ticket",
			{ title: "Ticket", type: "task", question: "?" },
			rt,
		);
		expect(result.text).toMatch(/Error:/);
	});

	it("creates a ticket on the active map", async () => {
		const ticket = makeTicket({ id: "t1", title: "Decision Ticket" });
		const wayfinder = makeFakeWayfinderTracker({
			createChildTicket: () => Promise.resolve(ticket),
		});
		const rt = makeRuntime({ wayfinder, activeMap: "m1" });
		const result = await act(
			"create_ticket",
			{ title: "Decision Ticket", type: "research", question: "How?" },
			rt,
		);
		expect(result.text).toContain("Ticket created:");
		expect(result.details).toMatchObject({ id: "t1" });
	});
});

// ---------------------------------------------------------------------------
// claim
// ---------------------------------------------------------------------------

describe("claim", () => {
	it("claims a ticket and reports claimed=true", async () => {
		const ticket = makeTicket({ id: "t1", title: "Work Item" });
		const wayfinder = makeFakeWayfinderTracker({
			claimTicketIfUnclaimed: () => Promise.resolve({ claimed: true, ticket }),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act("claim", { ticket_id: "t1" }, rt);
		expect(result.text).toContain("Claimed");
		expect(result.details).toMatchObject({ ticketId: "t1", claimed: true });
	});

	it("reports could not claim when ticket is already claimed", async () => {
		const ticket = makeTicket({ id: "t1", title: "Work Item" });
		const wayfinder = makeFakeWayfinderTracker({
			claimTicketIfUnclaimed: () => Promise.resolve({ claimed: false, ticket }),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act("claim", { ticket_id: "t1" }, rt);
		expect(result.text).toContain("Could not claim");
		expect(result.details).toMatchObject({ ticketId: "t1", claimed: false });
	});

	it("unclaims when claim=false", async () => {
		const ticket = makeTicket({ id: "t1", title: "Work Item" });
		const wayfinder = makeFakeWayfinderTracker({
			unclaimTicket: () => Promise.resolve(ticket),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act("claim", { ticket_id: "t1", claim: false }, rt);
		expect(result.text).toContain("Unclaimed");
		expect(result.details).toMatchObject({ claimed: false });
	});
});

// ---------------------------------------------------------------------------
// issue_list
// ---------------------------------------------------------------------------

describe("issue_list", () => {
	it("returns empty message when no issues match", async () => {
		const rt = makeRuntime({});
		const result = await act("issue_list", {}, rt);
		expect(result.text).toBe("No issues matched.");
		expect(result.details).toMatchObject({ count: 0 });
	});

	it("lists issues with status and labels", async () => {
		const issues = makeFakeIssueTracker({
			listIssues: () =>
				Promise.resolve([
					makeIssue({
						id: "i1",
						title: "Bug",
						status: "open",
						labels: ["bug"],
					}),
				]),
		});
		const rt = makeRuntime({ issues });
		const result = await act("issue_list", { state: "open" }, rt);
		expect(result.text).toContain("i1");
		expect(result.text).toContain("Bug");
		expect(result.details).toMatchObject({ count: 1 });
	});
});

// ---------------------------------------------------------------------------
// issue_create
// ---------------------------------------------------------------------------

describe("issue_create", () => {
	it("creates an issue and returns its id", async () => {
		const issue = makeIssue({ id: "i42", title: "New feature" });
		const issues = makeFakeIssueTracker({
			createIssue: () => Promise.resolve(issue),
		});
		const rt = makeRuntime({ issues });
		const result = await act("issue_create", { title: "New feature" }, rt);
		expect(result.text).toContain("Issue created:");
		expect(result.details).toMatchObject({ id: "i42" });
	});
});

// ---------------------------------------------------------------------------
// issue_label
// ---------------------------------------------------------------------------

describe("issue_label", () => {
	it("reports updated label set", async () => {
		const updated = makeIssue({ id: "i1", labels: ["bug", "priority"] });
		const issues = makeFakeIssueTracker({
			updateIssueLabels: () => Promise.resolve(updated),
		});
		const rt = makeRuntime({ issues });
		const result = await act(
			"issue_label",
			{ id: "i1", add: ["priority"] },
			rt,
		);
		expect(result.text).toContain("bug, priority");
		expect(result.details).toMatchObject({ labels: ["bug", "priority"] });
	});
});

// ---------------------------------------------------------------------------
// get_ticket
// ---------------------------------------------------------------------------

describe("get_ticket", () => {
	it("returns ticket detail with no blockers", async () => {
		const ticket = makeTicket({ id: "t1", title: "Decision" });
		const wayfinder = makeFakeWayfinderTracker({
			getTicketDetail: () => Promise.resolve({ ticket, blockers: [] }),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act("get_ticket", { ticket_id: "t1" }, rt);
		expect(result.details).toMatchObject({
			id: "t1",
			blockers: [],
			claimed: false,
		});
	});

	it("includes blocker ids in details", async () => {
		const ticket = makeTicket({ id: "t1", title: "Decision" });
		const wayfinder = makeFakeWayfinderTracker({
			getTicketDetail: () =>
				Promise.resolve({
					ticket,
					blockers: [{ id: "b1", title: "Blocker", url: "https://x/b1" }],
				}),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act("get_ticket", { ticket_id: "t1" }, rt);
		expect(result.details).toMatchObject({
			blockers: ["b1"],
			blockerTitles: ["Blocker"],
		});
	});
});

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

describe("resolve", () => {
	it("reports complete outcome with decision recorded", async () => {
		const ticket = makeTicket({ id: "t1", title: "Decision" });
		const wayfinder = makeFakeWayfinderTracker({
			resolveTicket: () =>
				Promise.resolve({
					outcome: "complete" as const,
					resolvedTicket: ticket,
					mapId: "m1",
					unblocked: [],
				}),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act(
			"resolve",
			{
				ticket_id: "t1",
				map_id: "m1",
				gist: "Chose approach A",
				resolution: "decided",
			},
			rt,
		);
		expect(result.text).toContain("Outcome: complete");
		expect(result.text).toContain(
			"Resolution recorded, ticket closed, and map decision recorded.",
		);
		expect(result.details).toMatchObject({
			outcome: "complete",
			decisionRecorded: true,
			resolutionPosted: true,
		});
	});

	it("reports terminal outcome with human inspection note", async () => {
		const ticket = makeTicket({ id: "t2", title: "Stale" });
		const wayfinder = makeFakeWayfinderTracker({
			resolveTicket: () =>
				Promise.resolve({
					outcome: "terminal" as const,
					resolvedTicket: ticket,
					mapId: "m1",
					unblocked: [],
				}),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act(
			"resolve",
			{
				ticket_id: "t2",
				map_id: "m1",
				gist: "abandoned",
				resolution: "abandoned",
			},
			rt,
		);
		expect(result.text).toContain("Outcome: terminal");
		expect(result.text).toContain("Human inspection is required");
		expect(result.details).toMatchObject({
			outcome: "terminal",
			decisionRecorded: false,
			resolutionPosted: false,
		});
	});

	it("lists unblocked tickets when resolution unblocks others", async () => {
		const ticket = makeTicket({ id: "t1", title: "Decision" });
		const unblocked = makeTicket({ id: "t2", title: "Next Step" });
		const wayfinder = makeFakeWayfinderTracker({
			resolveTicket: () =>
				Promise.resolve({
					outcome: "complete" as const,
					resolvedTicket: ticket,
					mapId: "m1",
					unblocked: [unblocked],
				}),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act(
			"resolve",
			{ ticket_id: "t1", map_id: "m1", gist: "done", resolution: "decided" },
			rt,
		);
		expect(result.text).toContain("Unblocked tickets:");
		expect(result.text).toContain("Next Step (t2)");
	});
});

// ---------------------------------------------------------------------------
// update_map
// ---------------------------------------------------------------------------

describe("update_map", () => {
	it("returns error when no map_id and no active map", async () => {
		const rt = makeRuntime({});
		const result = await act(
			"update_map",
			{ section: "notes", content: "text" },
			rt,
		);
		expect(result.text).toMatch(/Error:/);
	});

	it("updates a map section and reports success", async () => {
		const map = makeMap({ id: "m1", title: "Wayfinder: Test" });
		const wayfinder = makeFakeWayfinderTracker({
			updateMapSection: () => Promise.resolve(map),
		});
		const rt = makeRuntime({ wayfinder, activeMap: "m1" });
		const result = await act(
			"update_map",
			{ section: "notes", content: "Updated notes" },
			rt,
		);
		expect(result.text).toContain('section "notes" updated');
		expect(result.details).toMatchObject({ mapId: "m1", section: "notes" });
	});
});

// ---------------------------------------------------------------------------
// set_blocking
// ---------------------------------------------------------------------------

describe("set_blocking", () => {
	it("reports blocked-by list when blockers are set", async () => {
		const ticket = makeTicket({ id: "t1", title: "Work" });
		const blocker = { id: "b1", title: "Dependency", url: "https://x/b1" };
		const wayfinder = makeFakeWayfinderTracker({
			setBlockingDependencies: () => Promise.resolve(ticket),
			getTicketDetail: () => Promise.resolve({ ticket, blockers: [blocker] }),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act(
			"set_blocking",
			{ ticket_id: "t1", blocked_by: ["b1"] },
			rt,
		);
		expect(result.text).toContain("Blocked by:");
		expect(result.details).toMatchObject({ ticketId: "t1", blockedBy: ["b1"] });
	});

	it("reports blocking cleared when blocked_by is empty", async () => {
		const ticket = makeTicket({ id: "t1", title: "Work" });
		const wayfinder = makeFakeWayfinderTracker({
			setBlockingDependencies: () => Promise.resolve(ticket),
			getTicketDetail: () => Promise.resolve({ ticket, blockers: [] }),
		});
		const rt = makeRuntime({ wayfinder });
		const result = await act(
			"set_blocking",
			{ ticket_id: "t1", blocked_by: [] },
			rt,
		);
		expect(result.text).toContain("Blocking cleared");
		expect(result.details).toMatchObject({ blockedBy: [] });
	});
});

// ---------------------------------------------------------------------------
// list_frontier
// ---------------------------------------------------------------------------

describe("list_frontier", () => {
	it("returns error when no map_id and no active map", async () => {
		const rt = makeRuntime({});
		const result = await act("list_frontier", {}, rt);
		expect(result.text).toMatch(/Error:/);
	});

	it("returns empty message when no open tickets", async () => {
		const wayfinder = makeFakeWayfinderTracker({
			getMapDetail: () =>
				Promise.resolve({
					map: makeMap(),
					frontier: [],
					blocked: [],
					claimed: [],
					openCount: 0,
					closedCount: 0,
				}),
		});
		const rt = makeRuntime({ wayfinder, activeMap: "m1" });
		const result = await act("list_frontier", {}, rt);
		expect(result.text).toBe("No open tickets on this map.");
	});

	it("sets the requested map as active", async () => {
		const wayfinder = makeFakeWayfinderTracker({
			getMapDetail: () =>
				Promise.resolve({
					map: makeMap({ id: "m2" }),
					frontier: [],
					blocked: [],
					claimed: [],
					openCount: 0,
					closedCount: 0,
				}),
		});
		const rt = makeRuntime({ wayfinder, activeMap: "m1" });

		await act("list_frontier", { map_id: "m2" }, rt);

		expect(rt.activeMap).toBe("m2");
	});

	it("lists frontier, blocked, and claimed tickets", async () => {
		const frontierTicket = makeTicket({
			id: "t1",
			title: "Ready Work",
			type: "task",
		});
		const blockedTicket = makeTicket({
			id: "t2",
			title: "Blocked Work",
			type: "research",
		});
		const claimedTicket = makeTicket({
			id: "t3",
			title: "In Progress",
			type: "task",
		});
		const wayfinder = makeFakeWayfinderTracker({
			getMapDetail: () =>
				Promise.resolve({
					map: makeMap(),
					frontier: [frontierTicket],
					blocked: [{ ticket: blockedTicket, blockers: ["t1"] }],
					claimed: [claimedTicket],
					openCount: 3,
					closedCount: 0,
				}),
		});
		const rt = makeRuntime({ wayfinder, activeMap: "m1" });
		const result = await act("list_frontier", {}, rt);
		expect(result.text).toContain("Frontier (1");
		expect(result.text).toContain("Blocked (1");
		expect(result.text).toContain("Claimed (1");
		expect(result.details).toMatchObject({
			frontier: [{ id: "t1" }],
			blocked: [{ id: "t2", blockedBy: ["t1"] }],
			claimed: [{ id: "t3" }],
		});
	});
});

// ---------------------------------------------------------------------------
// issue_read
// ---------------------------------------------------------------------------

describe("issue_read", () => {
	it("returns issue details", async () => {
		const issue = makeIssue({ id: "i1", title: "Bug report", labels: ["bug"] });
		const issues = makeFakeIssueTracker({
			readIssue: () => Promise.resolve(issue),
		});
		const rt = makeRuntime({ issues });
		const result = await act("issue_read", { id: "i1" }, rt);
		expect(result.details).toMatchObject({
			id: "i1",
			title: "Bug report",
			labels: ["bug"],
		});
	});
});

// ---------------------------------------------------------------------------
// issue_comment
// ---------------------------------------------------------------------------

describe("issue_comment", () => {
	it("reports comment posted", async () => {
		const issues = makeFakeIssueTracker({
			commentOnIssue: () =>
				Promise.resolve({ comment: makeComment({ content: "Looks good" }) }),
		});
		const rt = makeRuntime({ issues });
		const result = await act(
			"issue_comment",
			{ id: "i1", body: "Looks good" },
			rt,
		);
		expect(result.text).toContain("Comment posted on i1");
		expect(result.details).toMatchObject({ id: "i1" });
	});

	it("includes postedAt when present", async () => {
		const issues = makeFakeIssueTracker({
			commentOnIssue: () =>
				Promise.resolve({
					comment: makeComment({
						content: "Done",
						postedAt: "2026-01-01T00:00:00Z",
					}),
				}),
		});
		const rt = makeRuntime({ issues });
		const result = await act("issue_comment", { id: "i1", body: "Done" }, rt);
		expect(result.text).toContain("at 2026-01-01T00:00:00Z");
	});
});

// ---------------------------------------------------------------------------
// issue_close
// ---------------------------------------------------------------------------

describe("issue_close", () => {
	it("closes an issue and reports status", async () => {
		const issues = makeFakeIssueTracker({
			closeIssue: () => Promise.resolve({ status: "closed" as const }),
		});
		const rt = makeRuntime({ issues });
		const result = await act("issue_close", { id: "i1" }, rt);
		expect(result.text).toContain("i1");
		expect(result.text).toContain("closed");
		expect(result.details).toMatchObject({ id: "i1", status: "closed" });
	});

	it("notes closing comment when provided", async () => {
		const issues = makeFakeIssueTracker({
			closeIssue: () => Promise.resolve({ status: "closed" as const }),
		});
		const rt = makeRuntime({ issues });
		const result = await act(
			"issue_close",
			{ id: "i1", comment: "Resolved by deploy" },
			rt,
		);
		expect(result.text).toContain("closing note posted");
	});
});
