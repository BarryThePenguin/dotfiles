/**
 * Minimal fake implementations of WayfinderTracker and IssueTracker for use
 * in tests. Override individual methods by spreading the fake with your stub.
 */

import type {
	WayfinderBlockerDetail,
	WayfinderClaimResult,
	WayfinderMapDetail,
	WayfinderTicketDetail,
	WayfinderTracker,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
} from "../tracker.ts";
import type {
	Issue,
	IssueComment,
	IssueStatus,
	IssueTracker,
} from "../issue.ts";

// ---------------------------------------------------------------------------
// Minimal valid data builders
// ---------------------------------------------------------------------------

export function makeMap(
	overrides?: Partial<WayfinderTrackerMap>,
): WayfinderTrackerMap {
	return {
		id: "map-1",
		title: "Wayfinder: Test Map",
		url: "https://example.com/map-1",
		destination: "Test destination",
		notes: "",
		decisionsSoFar: [],
		notYetSpecified: [],
		outOfScope: [],
		...overrides,
	};
}

export function makeTicket(
	overrides?: Partial<WayfinderTrackerTicket>,
): WayfinderTrackerTicket {
	return {
		id: "ticket-1",
		title: "Test Ticket",
		url: "https://example.com/ticket-1",
		mapId: "map-1",
		type: "task",
		question: "What to do?",
		blockerIds: [],
		status: "open",
		comments: [],
		...overrides,
	};
}

export function makeIssue(overrides?: Partial<Issue>): Issue {
	return {
		id: "issue-1",
		url: "https://example.com/issue-1",
		title: "Test Issue",
		body: "",
		labels: [],
		status: "open",
		comments: [],
		...overrides,
	};
}

export function makeComment(overrides?: Partial<IssueComment>): IssueComment {
	return { content: "Test comment", ...overrides };
}

// ---------------------------------------------------------------------------
// Fake tracker factories
// ---------------------------------------------------------------------------

export function makeFakeWayfinderTracker(
	overrides?: Partial<WayfinderTracker>,
): WayfinderTracker {
	return {
		createMap: () => Promise.resolve(makeMap()),
		listMaps: () => Promise.resolve([]),
		createChildTicket: () => Promise.resolve(makeTicket()),
		getMapDetail: (): Promise<WayfinderMapDetail> =>
			Promise.resolve({
				map: makeMap(),
				frontier: [],
				blocked: [],
				claimed: [],
				openCount: 0,
				closedCount: 0,
			}),
		getTicketDetail: (): Promise<WayfinderTicketDetail> =>
			Promise.resolve({ ticket: makeTicket(), blockers: [] }),
		claimTicketIfUnclaimed: (): Promise<WayfinderClaimResult> =>
			Promise.resolve({ claimed: true, ticket: makeTicket() }),
		unclaimTicket: () => Promise.resolve(makeTicket()),
		resolveTicket: () =>
			Promise.resolve({
				outcome: "complete" as const,
				resolvedTicket: makeTicket(),
				mapId: "map-1",
				unblocked: [] as WayfinderBlockerDetail[],
			}),
		setBlockingDependencies: () => Promise.resolve(makeTicket()),
		updateMapSection: () => Promise.resolve(makeMap()),
		...overrides,
	};
}

export function makeFakeIssueTracker(
	overrides?: Partial<IssueTracker>,
): IssueTracker {
	return {
		createIssue: () => Promise.resolve(makeIssue()),
		readIssue: () => Promise.resolve(makeIssue()),
		updateIssueLabels: () => Promise.resolve(makeIssue()),
		commentOnIssue: () => Promise.resolve({ comment: makeComment() }),
		closeIssue: (): Promise<{ status: IssueStatus }> =>
			Promise.resolve({ status: "closed" }),
		listIssues: () => Promise.resolve([]),
		...overrides,
	};
}
