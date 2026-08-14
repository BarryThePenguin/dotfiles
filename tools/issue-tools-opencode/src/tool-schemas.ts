/**
 * opencode tool schemas and registry.
 *
 * The opencode plugin mirrors the Pi extension's tool surface exactly: same
 * names, same snake_case params, same descriptions. The Pi surface is defined
 * with TypeBox in issue-tools-core; here we hand-roll the equivalent Zod
 * shapes (using the zod instance bundled with @opencode-ai/plugin) so the
 * models see identical guidance.
 */

import { Schema } from "effect";
import type { ActionMap } from "./actions.ts";

export type ToolSpec<A> = {
	name: string;
	action: keyof ActionMap;
	title: string;
	description: string;
	input: Schema.Codec<A>;
};

const spec = <A>(spec: ToolSpec<A>) => spec;

export const TOOLS = [
	spec({
		name: "wayfinder_chart",
		action: "chart",
		title: "Wayfinder: Chart",
		description:
			"Create a new wayfinder map after /grilling and /domain-modeling have confirmed the destination.",
		input: Schema.Struct({
			title: Schema.String.annotate({
				description: "Map title (without 'Wayfinder:' prefix)",
			}),
			destination: Schema.String.annotate({
				description:
					"User-confirmed destination after /grilling and /domain-modeling pre-map discovery (1-2 lines)",
			}),
			notes: Schema.optional(Schema.String).annotate({
				description:
					"Domain language, context, skills, and preferences surfaced during pre-map discovery",
			}),
		}),
	}),
	spec({
		name: "wayfinder_get_map",
		action: "get_map",
		title: "Wayfinder: Get Map",
		description: "Read the low-resolution wayfinder map.",
		input: Schema.Struct({
			map_id: Schema.optional(Schema.String).annotate({
				description: "Map task ID (defaults to active map)",
			}),
		}),
	}),
	spec({
		name: "wayfinder_list_maps",
		action: "list_maps",
		title: "Wayfinder: List Maps",
		description: "List all open wayfinder maps.",
		input: Schema.Struct({}),
	}),
	spec({
		name: "wayfinder_create_ticket",
		action: "create_ticket",
		title: "Wayfinder: Create Ticket",
		description: "Create a decision ticket on a wayfinder map.",
		input: Schema.Struct({
			map_id: Schema.optional(Schema.String).annotate({
				description: "Map task ID (defaults to active map)",
			}),
			title: Schema.String.annotate({
				description:
					"Name for the ticket. Refer to tickets by name in narration and decisions — names read at a glance, bare ids do not.",
			}),
			question: Schema.String.annotate({
				description: "The decision or investigation this ticket resolves",
			}),
			type: Schema.Literals([
				"research",
				"prototype",
				"grilling",
				"task",
			]).annotate({
				description: "Ticket type",
			}),
		}),
	}),
	spec({
		name: "wayfinder_get_ticket",
		action: "get_ticket",
		title: "Wayfinder: Get Ticket",
		description: "Read a wayfinder ticket's details.",
		input: Schema.Struct({
			ticket_id: Schema.String.annotate({
				description: "Ticket task ID",
			}),
		}),
	}),
	spec({
		name: "wayfinder_resolve",
		action: "resolve",
		title: "Wayfinder: Resolve",
		description:
			"Resolve a ticket: record resolution, close it, append to map's Decisions.",
		input: Schema.Struct({
			map_id: Schema.String.annotate({
				description: "The map that owns the Decision ticket",
			}),
			ticket_id: Schema.String.annotate({
				description: "Ticket task ID",
			}),
			resolution: Schema.String.annotate({
				description: "The answer or decision (posted as comment)",
			}),
			gist: Schema.String.annotate({
				description: "One-line summary for the map's Decisions so far",
			}),
		}),
	}),
	spec({
		name: "wayfinder_update_map",
		action: "update_map",
		title: "Wayfinder: Update Map",
		description:
			"Replace content of a map section (destination, notes, decisions, fog, out of scope).",
		input: Schema.Struct({
			map_id: Schema.optional(Schema.String).annotate({
				description: "Map task ID (defaults to active map)",
			}),
			section: Schema.Literals([
				"destination",
				"notes",
				"decisions",
				"notYetSpecified",
				"outOfScope",
			]).annotate({
				description: "Map section to replace",
			}),
			content: Schema.String.annotate({
				description: "New content for the section",
			}),
		}),
	}),
	spec({
		name: "wayfinder_set_blocking",
		action: "set_blocking",
		title: "Wayfinder: Set Blocking",
		description: "Wire blocking edges between tickets.",
		input: Schema.Struct({
			ticket_id: Schema.String.annotate({
				description: "Ticket task ID",
			}),
			blocked_by: Schema.Array(Schema.String).annotate({
				description: "Task IDs this is blocked by (empty to clear)",
			}),
		}),
	}),
	spec({
		name: "wayfinder_list_frontier",
		action: "list_frontier",
		title: "Wayfinder: List Frontier",
		description:
			"List open, unblocked, unclaimed tickets — the edge of the known.",
		input: Schema.Struct({
			map_id: Schema.optional(Schema.String).annotate({
				description: "Map task ID (defaults to active map)",
			}),
		}),
	}),
	spec({
		name: "wayfinder_claim",
		action: "claim",
		title: "Wayfinder: Claim",
		description: "Claim or unclaim a ticket so concurrent sessions skip it.",
		input: Schema.Struct({
			ticket_id: Schema.String.annotate({
				description: "Ticket task ID",
			}),
			claim: Schema.optional(Schema.Boolean).annotate({
				description: "true to claim, false to unclaim (default: true)",
			}),
		}),
	}),
	spec({
		name: "issue_create",
		action: "issue_create",
		title: "Issue: Create",
		description: "Create a repository Issue/spec.",
		input: Schema.Struct({
			title: Schema.String.annotate({
				description: "Issue title",
			}),
			body: Schema.optional(Schema.String).annotate({
				description: "Issue body / spec",
			}),
			labels: Schema.optional(Schema.Array(Schema.String)).annotate({
				description: "Labels to apply",
			}),
		}),
	}),
	spec({
		name: "issue_read",
		action: "issue_read",
		title: "Issue: Read",
		description: "Read a repository Issue/spec by its tracker ID or URL.",
		input: Schema.Struct({
			id: Schema.String.annotate({
				description: "Repository Issue/spec ID or URL.",
			}),
		}),
	}),
	spec({
		name: "issue_label",
		action: "issue_label",
		title: "Issue: Label",
		description:
			"Add or remove triage labels on a repository Issue/spec identified by ID or URL.",
		input: Schema.Struct({
			id: Schema.String.annotate({
				description: "Repository Issue/spec ID or URL.",
			}),
			add: Schema.optional(Schema.Array(Schema.String)).annotate({
				description: "Labels to add",
			}),
			remove: Schema.optional(Schema.Array(Schema.String)).annotate({
				description: "Labels to remove",
			}),
		}),
	}),
	spec({
		name: "issue_comment",
		action: "issue_comment",
		title: "Issue: Comment",
		description:
			"Post a comment on a repository Issue/spec identified by ID or URL.",
		input: Schema.Struct({
			id: Schema.String.annotate({
				description: "Repository Issue/spec ID or URL.",
			}),
			body: Schema.String.annotate({
				description: "Comment body",
			}),
		}),
	}),
	spec({
		name: "issue_close",
		action: "issue_close",
		title: "Issue: Close",
		description:
			"Close a repository Issue/spec identified by ID or URL, optionally with a closing note.",
		input: Schema.Struct({
			id: Schema.String.annotate({
				description: "Repository Issue/spec ID or URL.",
			}),
			comment: Schema.optional(Schema.String).annotate({
				description: "Closing note to post",
			}),
		}),
	}),
	spec({
		name: "issue_list",
		action: "issue_list",
		title: "Issue: List",
		description:
			"List repository Issues/specs, optionally filtered by state, labels, or unlabeled status. Results are oldest first.",
		input: Schema.Struct({
			state: Schema.optional(
				Schema.Literals(["open", "closed", "any"]),
			).annotate({
				description: "Issue state filter",
			}),
			labels: Schema.optional(Schema.Array(Schema.String)).annotate({
				description: "Label filter (all must match)",
			}),
			unlabeled: Schema.optional(Schema.Boolean).annotate({
				description: "Only issues with no labels",
			}),
		}),
	}),
];
