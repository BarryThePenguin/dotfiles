import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	LocalMarkdownTracker,
	type LocalMap,
	type LocalTicket,
} from "./local-tracker.ts";
import { createWayfinderTrackerTools } from "./tools.ts";

let rootDir: string;
let tools: ReturnType<typeof createWayfinderTrackerTools>;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "wayfinder-local-tools-"));
	tools = createWayfinderTrackerTools(new LocalMarkdownTracker(rootDir));
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
		expect(map.id).toMatch(/^map_[0-9a-f-]+$/);

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
		expect(ticket.id).toMatch(/^ticket_[0-9a-f-]+$/);
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
		expect(ticketIds.every((id) => /^ticket_[0-9a-f-]+$/.test(id))).toBe(true);
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

		await tools.wayfinder_close_ticket.run({ ticketId: blocker.id });

		expect(
			(
				(await tools.wayfinder_query_frontier.run({
					mapId: map.id,
				})) as LocalTicket[]
			).map((ticket) => ticket.id),
		).toEqual([blocked.id]);
	});

	it("claims tickets, posts resolutions, closes tickets, and updates maps", async () => {
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

		await tools.wayfinder_post_resolution.run({
			ticketId: ticket.id,
			body: "Resolution: use Todoist.",
		});
		await tools.wayfinder_update_map.run({
			mapId: map.id,
			decision: {
				title: ticket.title,
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		});
		await tools.wayfinder_close_ticket.run({ ticketId: ticket.id });

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
