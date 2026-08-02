import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	LocalMarkdownTracker,
	type LocalMap,
	type LocalTicket,
} from "./local-markdown-adapter.ts";
import { createWayfinderTrackerTools } from "./tools.ts";

let rootDir: string;
let tracker: LocalMarkdownTracker;
let tools: ReturnType<typeof createWayfinderTrackerTools>;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "wayfinder-local-tools-"));
	tracker = new LocalMarkdownTracker(rootDir);
	tools = createWayfinderTrackerTools(tracker);
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("local Wayfinder tracker tools", () => {
	it("creates a map and fetches it", async () => {
		const map = (await tools.wayfinder_create_map.run({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
			notes: "Use local tracker in tests.",
			notYetSpecified: ["How to claim Todoist tasks."],
		})) as LocalMap;

		expect(map).toMatchObject({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		expect(map.id).toBe("plan-todoist-wayfinder");

		await expect(
			tools.wayfinder_get_map.run({ mapId: map.id }),
		).resolves.toEqual(map);
	});

	it("creates tickets and lists children", async () => {
		const map = (await tools.wayfinder_create_map.run({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		})) as LocalMap;

		const ticket = (await tools.wayfinder_create_ticket.run({
			mapId: map.id,
			title: "Choose tracker",
			type: "grilling",
			question: "Which tracker owns durable state?",
		})) as LocalTicket;

		expect(ticket).toMatchObject({
			mapId: map.id,
			type: "grilling",
			status: "open",
		});
		expect(ticket.id).toBe("plan-todoist-wayfinder/01-choose-tracker");
		await expect(
			tools.wayfinder_list_children.run({ mapId: map.id }),
		).resolves.toEqual([ticket]);
		await expect(
			tools.wayfinder_get_ticket.run({ ticketId: ticket.id }),
		).resolves.toEqual(ticket);
	});

	it("allocates unique ticket IDs for concurrent local ticket creation", async () => {
		const map = (await tools.wayfinder_create_map.run({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		})) as LocalMap;

		const tickets = (await Promise.all(
			Array.from({ length: 5 }, (_, index) =>
				tools.wayfinder_create_ticket.run({
					mapId: map.id,
					title: `Concurrent ticket ${index + 1}`,
					type: "task",
					question: "Does local allocation stay unique?",
				}),
			),
		)) as LocalTicket[];

		const ticketIds = tickets.map((ticket) => ticket.id);
		expect(ticketIds).toEqual([
			"plan-todoist-wayfinder/01-concurrent-ticket-1",
			"plan-todoist-wayfinder/02-concurrent-ticket-2",
			"plan-todoist-wayfinder/03-concurrent-ticket-3",
			"plan-todoist-wayfinder/04-concurrent-ticket-4",
			"plan-todoist-wayfinder/05-concurrent-ticket-5",
		]);
		expect(new Set(ticketIds)).toHaveLength(5);
		expect(
			(
				(await tools.wayfinder_list_children.run({
					mapId: map.id,
				})) as LocalTicket[]
			)
				.map((ticket) => ticket.id)
				.toSorted(),
		).toEqual(ticketIds.toSorted());
	});

	it("queries frontier and wires blockers", async () => {
		const map = (await tools.wayfinder_create_map.run({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		})) as LocalMap;
		const blocker = (await tools.wayfinder_create_ticket.run({
			mapId: map.id,
			title: "Blocking research",
			type: "research",
			question: "What blocks the next decision?",
		})) as LocalTicket;
		const blocked = (await tools.wayfinder_create_ticket.run({
			mapId: map.id,
			title: "Blocked decision",
			type: "grilling",
			question: "What follows the research?",
		})) as LocalTicket;

		await tools.wayfinder_wire_blocking.run({
			ticketId: blocked.id,
			blockerId: blocker.id,
		});

		expect(
			(
				(await tools.wayfinder_query_frontier.run({
					mapId: map.id,
				})) as LocalTicket[]
			).map((ticket) => ticket.id),
		).toEqual([blocker.id]);

		await tracker.closeTicket(blocker.id);

		expect(
			(
				(await tools.wayfinder_query_frontier.run({
					mapId: map.id,
				})) as LocalTicket[]
			).map((ticket) => ticket.id),
		).toEqual([blocked.id]);
	});

	it("claims tickets, reads resolutions, and updates maps", async () => {
		const map = (await tools.wayfinder_create_map.run({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		})) as LocalMap;
		const ticket = (await tools.wayfinder_create_ticket.run({
			mapId: map.id,
			title: "Choose tracker",
			type: "grilling",
			question: "Which tracker owns durable state?",
		})) as LocalTicket;

		expect(
			await tools.wayfinder_claim_ticket.run({
				ticketId: ticket.id,
				claimant: "agent-1",
			}),
		).toMatchObject({ claimed: true, ticket: { claimedBy: "agent-1" } });
		expect(
			await tools.wayfinder_claim_ticket.run({
				ticketId: ticket.id,
				claimant: "agent-2",
			}),
		).toMatchObject({ claimed: false, ticket: { claimedBy: "agent-1" } });

		await tracker.resolveTicket(ticket.id, "Resolution: use Todoist.");
		await tools.wayfinder_update_map.run({
			mapId: map.id,
			decision: {
				title: ticket.title,
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		});
		expect(
			await tools.wayfinder_get_ticket.run({ ticketId: ticket.id }),
		).toMatchObject({
			status: "closed",
			comments: ["Resolution: use Todoist."],
		});
		expect(await tools.wayfinder_get_map.run({ mapId: map.id })).toMatchObject({
			decisionsSoFar: [
				{
					title: "Choose tracker",
					url: ticket.url,
					gist: "Todoist owns durable state.",
				},
			],
		});
	});

	it("validates tool input", async () => {
		await expect(
			tools.wayfinder_create_ticket.run({
				mapId: "map_missing",
				title: "Bad type",
				type: "not-a-ticket-type",
				question: "Will validation reject this?",
			}),
		).rejects.toThrow();
	});
});
