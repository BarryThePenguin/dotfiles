import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addTaskComment } from "doist-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMarkdownPersistenceAdapter } from "./local-markdown-adapter.ts";
import type { WayfinderPersistence } from "./modules.ts";
import { createTodoistFixture } from "./test-helpers/todoist-fixture.ts";

type Fixture = {
	tracker: WayfinderPersistence;
	addOrdinaryComment: (ticketId: string, body: string) => Promise<void>;
	cleanup: () => Promise<void>;
};

async function localFixture(): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "resolution-contract-local-"));
	const tracker = new LocalMarkdownPersistenceAdapter(root);
	return {
		tracker,
		addOrdinaryComment: async (ticketId, body) => {
			const ticket = await tracker.getTicket(ticketId);
			const path = join(root, ticket.mapId, ticket.url);
			const markdown = await readFile(path, "utf8");
			await writeFile(path, `${markdown}\n## Comments\n\n> ${body}\n`);
		},
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

function todoistFixture(): Fixture {
	const engine = createTodoistFixture({ projectId: "project-1" });
	return {
		tracker: engine.adapter,
		addOrdinaryComment: async (ticketId, body) => {
			await addTaskComment(engine.db, engine.client, ticketId, body);
		},
		cleanup: () => {
			engine.cleanup();
			return Promise.resolve();
		},
	};
}

const fixtures = [
	["Local Markdown", localFixture],
	["Todoist", todoistFixture],
] as const;

describe.each(fixtures)("%s resolution contract", (_name, createFixture) => {
	let fixture: Fixture;
	let mapId: string;
	let ticketId: string;

	beforeEach(async () => {
		fixture = await createFixture();
		const map = await fixture.tracker.createMap({
			title: "Resolution contract",
			destination: "The first Resolution is durable.",
		});
		mapId = map.id;
		const ticket = await fixture.tracker.createChildTicket({
			mapId,
			title: "Choose a resolution",
			type: "grilling",
			question: "Which answer wins?",
		});
		ticketId = ticket.id;
	});

	afterEach(async () => {
		await fixture.cleanup();
	});

	it("records the first Resolution and closes the ticket together", async () => {
		const resolved = await fixture.tracker.recordResolution(
			ticketId,
			"Use the tracker-native seam.",
		);

		expect(resolved.status).toBe("closed");
		expect(resolved.comments).toContain("Use the tracker-native seam.");
	});

	it("makes a repeated matching Resolution a no-op", async () => {
		await fixture.tracker.recordResolution(ticketId, "Keep the first answer.");

		const repeated = await fixture.tracker.recordResolution(
			ticketId,
			"Keep the first answer.",
		);

		expect(repeated.status).toBe("closed");
		expect(repeated.comments).toEqual(["Keep the first answer."]);
	});

	it("does not replace a different first Resolution", async () => {
		await fixture.tracker.recordResolution(ticketId, "The first answer.");

		await expect(
			fixture.tracker.recordResolution(ticketId, "A replacement answer."),
		).rejects.toThrow(/Resolution/i);

		const ticket = await fixture.tracker.getTicket(ticketId);
		expect(ticket.comments).toContain("The first answer.");
	});

	it("rejects a closed ticket that has no matching Resolution", async () => {
		await fixture.tracker.closeTicket(ticketId);

		await expect(
			fixture.tracker.recordResolution(ticketId, "Too late."),
		).rejects.toThrow(/Resolution/i);
	});

	it("preserves an ordinary comment while recording the Resolution", async () => {
		await fixture.addOrdinaryComment(ticketId, "An existing note.");
		await fixture.tracker.recordResolution(ticketId, "The durable answer.");

		const ticket = await fixture.tracker.getTicket(ticketId);
		expect(ticket.comments).toContain("An existing note.");
		expect(ticket.comments).toContain("The durable answer.");
	});
});
