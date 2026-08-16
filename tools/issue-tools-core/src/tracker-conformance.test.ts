import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createTrackerModulesFromBackend,
	type TrackerModules,
} from "./modules.ts";
import { createLocalTrackerModules } from "./local-tracker-factory.ts";
import { localTrackerRoot } from "./session.ts";
import { createTodoistFixture } from "./test-helpers/todoist-fixture.ts";
/**
 * The domain contract is deliberately exercised through the two public
 * modules. A backend fixture only supplies those modules and its lifecycle;
 * these scenarios must not know how either tracker stores a record.
 */
type TrackerFixture = "Local Markdown" | "Todoist";
const fixtures: TrackerFixture[] = ["Local Markdown", "Todoist"];

async function withFixture(
	fixture: TrackerFixture,
	callback: (modules: TrackerModules) => Promise<void>,
) {
	if (fixture === "Todoist") {
		const todoist = createTodoistFixture({ projectId: "project-1" });
		try {
			await callback(createTrackerModulesFromBackend(todoist.adapter));
		} finally {
			todoist.cleanup();
		}
		return;
	}

	const root = mkdtempDisposableSync(join(tmpdir(), "tracker-conformance-"));
	try {
		await callback(createLocalTrackerModules(localTrackerRoot(root.path)));
	} finally {
		root.remove();
	}
}

for (const fixture of fixtures) {
	describe(`${fixture} tracker conformance`, () => {
		it("supports the Issue interface", async () => {
			await withFixture(fixture, async ({ issues }) => {
				const issue = await issues.createIssue({
					title: "Conformance issue",
					body: "The body is observable through Issue.",
					labels: ["needs-triage"],
				});

				await issues.updateIssueLabels(issue.id, {
					add: ["bug"],
					remove: ["needs-triage"],
				});
				await issues.commentOnIssue(issue.id, "Agent note");
				await issues.closeIssue(issue.id, { comment: "Done" });

				const read = await issues.readIssue(issue.url);
				expect(read).toMatchObject({
					id: issue.id,
					title: "Conformance issue",
					body: "The body is observable through Issue.",
					labels: ["bug"],
					status: "closed",
				});
				expect(read.comments.map((comment) => comment.content)).toEqual([
					"Agent note",
					"Done",
				]);
				expect(
					await issues.listIssues({ state: "closed", labels: ["bug"] }),
				).toEqual([read]);
			});
		});

		it("supports the Wayfinder interface and unblocks dependent work", async () => {
			await withFixture(fixture, async ({ wayfinder }) => {
				const map = await wayfinder.createMap({
					title: "Conformance map",
					destination: "A shared Wayfinder behavior exists.",
				});
				const blocker = await wayfinder.createChildTicket({
					mapId: map.id,
					title: "Make the decision",
					type: "research",
					question: "Which behavior is correct?",
				});
				const dependent = await wayfinder.createChildTicket({
					mapId: map.id,
					title: "Apply the decision",
					type: "task",
					question: "What follows?",
					blockerIds: [blocker.id],
				});

				expect(
					(await wayfinder.getMapDetail(map.id)).frontier.map((t) => t.id),
				).toEqual([blocker.id]);
				const result = await wayfinder.resolveTicket({
					ticketId: blocker.id,
					mapId: map.id,
					resolution: "Use the shared domain contract.",
					gist: "The interfaces define observable behavior.",
				});

				expect(result.outcome).toBe("complete");
				expect(
					(await wayfinder.getMapDetail(map.id)).frontier.map((t) => t.id),
				).toEqual([dependent.id]);
				expect(
					(await wayfinder.getTicketDetail(blocker.id)).ticket.comments,
				).toEqual(["Use the shared domain contract."]);
				expect(
					(await wayfinder.getMapDetail(map.id)).map.decisionsSoFar,
				).toEqual([
					{
						title: blocker.title,
						url: blocker.url,
						gist: "The interfaces define observable behavior.",
					},
				]);
			});
		});
	});
}
