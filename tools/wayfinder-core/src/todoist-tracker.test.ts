import { describe, expect, it } from "vitest";
import {
	TODOIST_TICKET_TYPE_LABELS,
	WAYFINDER_MAP_LABEL,
} from "./labels.ts";
import {
	InMemoryTodoistGateway,
	TodoistTracker,
} from "./todoist-tracker.ts";

describe("TodoistTracker", () => {
	it("creates a map task and ticket subtasks using Todoist labels", async () => {
		const gateway = new InMemoryTodoistGateway();
		const tracker = new TodoistTracker(gateway, { projectId: "project-1" });

		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
			notes: "Use subtasks as tickets.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose dependency representation",
			type: "grilling",
			question: "How should blockers be represented?",
		});

		expect(gateway.tasks.get(map.id)).toMatchObject({
			content: "Plan Todoist Wayfinder",
			projectId: "project-1",
			labels: [WAYFINDER_MAP_LABEL],
		});
		expect(gateway.tasks.get(ticket.id)).toMatchObject({
			content: "Choose dependency representation",
			parentId: map.id,
			labels: [TODOIST_TICKET_TYPE_LABELS.grilling],
		});
		expect(ticket).toMatchObject({
			mapId: map.id,
			type: "grilling",
			status: "open",
		});
	});

	it("lists frontier tickets using completion, claim metadata, and blocker metadata", async () => {
		const tracker = new TodoistTracker(new InMemoryTodoistGateway(), {
			projectId: "project-1",
		});
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const blocker = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocking research",
			type: "research",
			question: "What blocks the next decision?",
		});
		const blocked = await tracker.createChildTicket({
			mapId: map.id,
			title: "Blocked decision",
			type: "grilling",
			question: "What follows research?",
			blockerIds: [blocker.id],
		});
		const claimed = await tracker.createChildTicket({
			mapId: map.id,
			title: "Claimed decision",
			type: "task",
			question: "Who owns this?",
		});
		await tracker.claimTicketIfUnclaimed(claimed.id, "agent-1");

		expect((await tracker.listFrontierTickets(map.id)).map((t) => t.id)).toEqual([
			blocker.id,
		]);

		await tracker.closeTicket(blocker.id);

		expect((await tracker.listFrontierTickets(map.id)).map((t) => t.id)).toEqual([
			blocked.id,
		]);
	});

	it("claims, comments on, records, and closes Todoist tickets", async () => {
		const gateway = new InMemoryTodoistGateway();
		const tracker = new TodoistTracker(gateway, { projectId: "project-1" });
		const map = await tracker.createMap({
			title: "Plan Todoist Wayfinder",
			destination: "A Todoist-backed MVP exists.",
		});
		const ticket = await tracker.createChildTicket({
			mapId: map.id,
			title: "Choose tracker",
			type: "grilling",
			question: "Which tracker owns durable state?",
		});

		expect(
			await tracker.claimTicketIfUnclaimed(ticket.id, "agent-1"),
		).toMatchObject({ claimed: true, ticket: { claimedBy: "agent-1" } });
		expect(
			await tracker.claimTicketIfUnclaimed(ticket.id, "agent-2"),
		).toMatchObject({ claimed: false, ticket: { claimedBy: "agent-1" } });

		await tracker.postComment(ticket.id, "Resolution: use Todoist.");
		await tracker.recordDecision(map.id, {
			title: ticket.title,
			url: ticket.url,
			gist: "Todoist owns durable state.",
		});
		await tracker.closeTicket(ticket.id);

		expect(await tracker.getTicket(ticket.id)).toMatchObject({
			status: "closed",
			comments: ["Resolution: use Todoist."],
		});
		expect((await tracker.getMap(map.id)).decisionsSoFar).toEqual([
			{
				title: "Choose tracker",
				url: ticket.url,
				gist: "Todoist owns durable state.",
			},
		]);
	});
});
