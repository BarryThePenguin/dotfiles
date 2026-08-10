/**
 * opencode tool schemas and registry.
 *
 * The opencode plugin mirrors the Pi extension's tool surface exactly: same
 * names, same snake_case params, same descriptions. The Pi surface is defined
 * with TypeBox in issue-tools-core; here we hand-roll the equivalent Zod
 * shapes (using the zod instance bundled with @opencode-ai/plugin) so the
 * models see identical guidance.
 */

import { tool } from "@opencode-ai/plugin";
import type { ActionMap } from "./actions.ts";

const z = tool.schema;

type Args = z.ZodRawShape;

export type ToolSpec<A extends Args = Args> = {
	name: string;
	action: keyof ActionMap;
	title: string;
	description: string;
	args: A;
};

const spec = <A extends Args>(s: ToolSpec<A>): ToolSpec<A> => s;

export const TOOLS = [
	spec({
		name: "wayfinder_chart",
		action: "chart",
		title: "Wayfinder: Chart",
		description:
			"Create a new wayfinder map after /grilling and /domain-modeling have confirmed the destination.",
		args: {
			title: z.string().describe("Map title (without 'Wayfinder:' prefix)"),
			destination: z
				.string()
				.describe(
					"User-confirmed destination after /grilling and /domain-modeling pre-map discovery (1-2 lines)",
				),
			notes: z
				.string()
				.optional()
				.describe(
					"Domain language, context, skills, and preferences surfaced during pre-map discovery",
				),
		},
	}),
	spec({
		name: "wayfinder_get_map",
		action: "get_map",
		title: "Wayfinder: Get Map",
		description: "Read the low-resolution wayfinder map.",
		args: {
			map_id: z
				.string()
				.optional()
				.describe("Map task ID (defaults to active map)"),
		},
	}),
	spec({
		name: "wayfinder_list_maps",
		action: "list_maps",
		title: "Wayfinder: List Maps",
		description: "List all open wayfinder maps.",
		args: {},
	}),
	spec({
		name: "wayfinder_create_ticket",
		action: "create_ticket",
		title: "Wayfinder: Create Ticket",
		description: "Create a decision ticket on a wayfinder map.",
		args: {
			map_id: z
				.string()
				.optional()
				.describe("Map task ID (defaults to active map)"),
			title: z
				.string()
				.describe(
					"Name for the ticket. Refer to tickets by name in narration and decisions — names read at a glance, bare ids do not.",
				),
			question: z
				.string()
				.describe("The decision or investigation this ticket resolves"),
			type: z
				.enum(["research", "prototype", "grilling", "task"])
				.describe("Ticket type"),
		},
	}),
	spec({
		name: "wayfinder_get_ticket",
		action: "get_ticket",
		title: "Wayfinder: Get Ticket",
		description: "Read a wayfinder ticket's details.",
		args: {
			ticket_id: z.string().describe("Ticket task ID"),
		},
	}),
	spec({
		name: "wayfinder_resolve",
		action: "resolve",
		title: "Wayfinder: Resolve",
		description:
			"Resolve a ticket: record resolution, close it, append to map's Decisions.",
		args: {
			map_id: z.string().describe("The map that owns the Decision ticket"),
			ticket_id: z.string().describe("Ticket task ID"),
			resolution: z
				.string()
				.describe("The answer or decision (posted as comment)"),
			gist: z
				.string()
				.describe("One-line summary for the map's Decisions so far"),
		},
	}),
	spec({
		name: "wayfinder_update_map",
		action: "update_map",
		title: "Wayfinder: Update Map",
		description:
			"Replace content of a map section (destination, notes, decisions, fog, out of scope).",
		args: {
			map_id: z
				.string()
				.optional()
				.describe("Map task ID (defaults to active map)"),
			section: z
				.enum([
					"destination",
					"notes",
					"decisions",
					"notYetSpecified",
					"outOfScope",
				])
				.describe("Map section to replace"),
			content: z.string().describe("New content for the section"),
		},
	}),
	spec({
		name: "wayfinder_set_blocking",
		action: "set_blocking",
		title: "Wayfinder: Set Blocking",
		description: "Wire blocking edges between tickets.",
		args: {
			ticket_id: z.string().describe("Ticket task ID"),
			blocked_by: z
				.array(z.string())
				.describe("Task IDs this is blocked by (empty to clear)"),
		},
	}),
	spec({
		name: "wayfinder_list_frontier",
		action: "list_frontier",
		title: "Wayfinder: List Frontier",
		description:
			"List open, unblocked, unclaimed tickets — the edge of the known.",
		args: {
			map_id: z
				.string()
				.optional()
				.describe("Map task ID (defaults to active map)"),
		},
	}),
	spec({
		name: "wayfinder_claim",
		action: "claim",
		title: "Wayfinder: Claim",
		description: "Claim or unclaim a ticket so concurrent sessions skip it.",
		args: {
			ticket_id: z.string().describe("Ticket task ID"),
			claim: z
				.boolean()
				.optional()
				.describe("true to claim, false to unclaim (default: true)"),
		},
	}),
	spec({
		name: "issue_create",
		action: "issue_create",
		title: "Issue: Create",
		description: "Create a repository Issue/spec.",
		args: {
			title: z.string().describe("Issue title"),
			body: z.string().optional().describe("Issue body / spec"),
			labels: z.array(z.string()).optional().describe("Labels to apply"),
		},
	}),
	spec({
		name: "issue_read",
		action: "issue_read",
		title: "Issue: Read",
		description: "Read a repository Issue/spec by its tracker ID or URL.",
		args: {
			id: z.string().describe("Repository Issue/spec ID or URL."),
		},
	}),
	spec({
		name: "issue_label",
		action: "issue_label",
		title: "Issue: Label",
		description:
			"Add or remove triage labels on a repository Issue/spec identified by ID or URL.",
		args: {
			id: z.string().describe("Repository Issue/spec ID or URL."),
			add: z.array(z.string()).optional().describe("Labels to add"),
			remove: z.array(z.string()).optional().describe("Labels to remove"),
		},
	}),
	spec({
		name: "issue_comment",
		action: "issue_comment",
		title: "Issue: Comment",
		description:
			"Post a comment on a repository Issue/spec identified by ID or URL.",
		args: {
			id: z.string().describe("Repository Issue/spec ID or URL."),
			body: z.string().describe("Comment body"),
		},
	}),
	spec({
		name: "issue_close",
		action: "issue_close",
		title: "Issue: Close",
		description:
			"Close a repository Issue/spec identified by ID or URL, optionally with a closing note.",
		args: {
			id: z.string().describe("Repository Issue/spec ID or URL."),
			comment: z.string().optional().describe("Closing note to post"),
		},
	}),
	spec({
		name: "issue_list",
		action: "issue_list",
		title: "Issue: List",
		description:
			"List repository Issues/specs, optionally filtered by state, labels, or unlabeled status. Results are oldest first.",
		args: {
			state: z
				.enum(["open", "closed", "any"])
				.optional()
				.describe("Issue state filter"),
			labels: z
				.array(z.string())
				.optional()
				.describe("Label filter (all must match)"),
			unlabeled: z.boolean().optional().describe("Only issues with no labels"),
		},
	}),
];
