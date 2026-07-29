import * as v from "valibot";
import type { MapSectionKey } from "./map-body.ts";
import type {
	CreateLocalChildTicketInput,
	CreateLocalMapInput,
	LocalClaimResult,
	LocalMap,
	LocalTicket,
} from "./local-tracker.ts";
import {
	DecisionSummarySchema,
	ParsedMapBodySchema,
	TicketTypeSchema,
	WayfinderTicketSchema,
} from "./schema.ts";

export const WayfinderToolNameSchema = v.picklist([
	"wayfinder_get_map",
	"wayfinder_create_map",
	"wayfinder_create_ticket",
	"wayfinder_query_frontier",
	"wayfinder_claim_ticket",
	"wayfinder_get_ticket",
	"wayfinder_post_resolution",
	"wayfinder_close_ticket",
	"wayfinder_update_map",
	"wayfinder_wire_blocking",
	"wayfinder_list_children",
] as const);
export type WayfinderToolName = v.InferOutput<typeof WayfinderToolNameSchema>;

const LocalMapOutputSchema = v.object({
	id: v.string(),
	title: v.string(),
	url: v.string(),
	...ParsedMapBodySchema.entries,
});

const LocalTicketOutputSchema = v.object({
	...WayfinderTicketSchema.entries,
	url: v.string(),
	status: v.picklist(["open", "closed"] as const),
	comments: v.array(v.string()),
});

const CreateMapInputSchema = v.object({
	title: v.string(),
	destination: v.string(),
	notes: v.optional(v.string()),
	notYetSpecified: v.optional(v.array(v.string())),
});

const CreateTicketInputSchema = v.object({
	mapId: v.string(),
	title: v.string(),
	type: TicketTypeSchema,
	question: v.string(),
	blockerIds: v.optional(v.array(v.string())),
});

const MapIdInputSchema = v.object({ mapId: v.string() });
const TicketIdInputSchema = v.object({ ticketId: v.string() });

const ClaimTicketInputSchema = v.object({
	ticketId: v.string(),
	claimant: v.string(),
});

const ClaimTicketOutputSchema = v.object({
	claimed: v.boolean(),
	ticket: LocalTicketOutputSchema,
});

const PostResolutionInputSchema = v.object({
	ticketId: v.string(),
	body: v.string(),
});

const OkOutputSchema = v.object({ ok: v.literal(true) });

const UpdateMapInputSchema = v.object({
	mapId: v.string(),
	decision: DecisionSummarySchema,
});

const WireBlockingInputSchema = v.object({
	ticketId: v.string(),
	blockerId: v.string(),
});

const TicketListOutputSchema = v.array(LocalTicketOutputSchema);

export interface WayfinderTracker {
	createMap(input: CreateLocalMapInput): Promise<LocalMap>;
	listMaps(): Promise<LocalMap[]>;
	createChildTicket(input: CreateLocalChildTicketInput): Promise<LocalTicket>;
	getMap(id: string): Promise<LocalMap>;
	getTicket(id: string): Promise<LocalTicket>;
	listChildTickets(mapId: string): Promise<LocalTicket[]>;
	listFrontierTickets(mapId: string): Promise<LocalTicket[]>;
	claimTicketIfUnclaimed(
		id: string,
		claimant: string,
	): Promise<LocalClaimResult>;
	unclaimTicket(id: string): Promise<LocalTicket>;
	closeTicket(id: string): Promise<LocalTicket>;
	postComment(id: string, body: string): Promise<void>;
	setBlockingDependencies(
		id: string,
		blockerIds: string[],
	): Promise<LocalTicket>;
	addBlockingDependency(id: string, blockerId: string): Promise<LocalTicket>;
	recordDecision(
		mapId: string,
		decision: v.InferOutput<typeof DecisionSummarySchema>,
	): Promise<LocalMap>;
	updateMapSection(
		mapId: string,
		section: MapSectionKey,
		content: string,
	): Promise<LocalMap>;
}

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| {
			[key: string]: JsonValue;
	  };
type ToolInputSchema = v.GenericSchema<Record<string, unknown>, unknown>;
type ToolOutputSchema = v.GenericSchema<unknown, NonNullable<unknown> | null>;
type ToolRunResult<S extends ToolOutputSchema | undefined> =
	S extends ToolOutputSchema ? v.InferInput<S> : JsonValue | undefined;
interface ToolDefinition<
	TInput extends ToolInputSchema | undefined = ToolInputSchema | undefined,
	TOutput extends ToolOutputSchema | undefined = ToolOutputSchema | undefined,
> {
	readonly name: WayfinderToolName;
	readonly description: string;
	readonly input: TInput;
	readonly output: TOutput;
	run: (
		context: TInput extends ToolInputSchema
			? v.InferOutput<TInput>
			: JsonValue | undefined,
	) => ToolRunResult<TOutput> | Promise<ToolRunResult<TOutput>>;
}

export type WayfinderTrackerTool<
	TInput extends ToolInputSchema | undefined = undefined,
	TOutput extends ToolOutputSchema | undefined = undefined,
> = {
	name: WayfinderToolName;
	description: string;
	input?: TInput;
	output?: TOutput;
	run: ToolDefinition<TInput, TOutput>["run"];
};

type WayfinderTrackerTools = {
	[K in WayfinderToolName]: WayfinderTrackerTool<
		ToolInputSchema,
		ToolOutputSchema
	>;
};

function defineTool<
	I extends ToolInputSchema | undefined = undefined,
	O extends ToolOutputSchema | undefined = undefined,
>({
	name,
	description,
	input,
	output,
	run,
}: ToolDefinition<I, O>): WayfinderTrackerTool<I, O> {
	return {
		name,
		description,
		input,
		output,
		async run(context) {
			const parsedContext = input ? v.parse(input, context) : context;
			const result = await run(parsedContext as Parameters<typeof run>[0]);

			if (output) {
				return v.parse(output, result) as ToolRunResult<O>;
			}

			return result;
		},
	};
}

export function createWayfinderTrackerTools(
	tracker: WayfinderTracker,
): WayfinderTrackerTools {
	return {
		wayfinder_get_map: defineTool({
			name: "wayfinder_get_map",
			description: "Fetch a Wayfinder map by tracker map task ID.",
			input: MapIdInputSchema,
			output: LocalMapOutputSchema,
			run: ({ mapId }) => tracker.getMap(mapId),
		}),

		wayfinder_create_map: defineTool({
			name: "wayfinder_create_map",
			description:
				"Create a Wayfinder map task with the canonical map sections.",
			input: CreateMapInputSchema,
			output: LocalMapOutputSchema,
			run: (input) =>
				tracker.createMap({
					title: input.title,
					destination: input.destination,
					...(input.notes !== undefined ? { notes: input.notes } : {}),
					...(input.notYetSpecified !== undefined
						? { notYetSpecified: input.notYetSpecified }
						: {}),
				}),
		}),

		wayfinder_create_ticket: defineTool({
			name: "wayfinder_create_ticket",
			description: "Create a Wayfinder child ticket under a map.",
			input: CreateTicketInputSchema,
			output: LocalTicketOutputSchema,
			run: (input) =>
				tracker.createChildTicket({
					mapId: input.mapId,
					title: input.title,
					type: input.type,
					question: input.question,
					...(input.blockerIds !== undefined
						? { blockerIds: input.blockerIds }
						: {}),
				}),
		}),

		wayfinder_query_frontier: defineTool({
			name: "wayfinder_query_frontier",
			description:
				"List incomplete, unclaimed, unblocked child tickets for a Wayfinder map.",
			input: MapIdInputSchema,
			output: TicketListOutputSchema,
			run: ({ mapId }) => tracker.listFrontierTickets(mapId),
		}),

		wayfinder_claim_ticket: defineTool({
			name: "wayfinder_claim_ticket",
			description: "Claim an open unclaimed Wayfinder ticket for an actor.",
			input: ClaimTicketInputSchema,
			output: ClaimTicketOutputSchema,
			run: ({ ticketId, claimant }) =>
				tracker.claimTicketIfUnclaimed(ticketId, claimant),
		}),

		wayfinder_get_ticket: defineTool({
			name: "wayfinder_get_ticket",
			description: "Fetch a Wayfinder ticket by tracker task ID.",
			input: TicketIdInputSchema,
			output: LocalTicketOutputSchema,
			run: ({ ticketId }) => tracker.getTicket(ticketId),
		}),

		wayfinder_post_resolution: defineTool({
			name: "wayfinder_post_resolution",
			description: "Post a resolution comment on a Wayfinder ticket.",
			input: PostResolutionInputSchema,
			output: OkOutputSchema,
			async run({ ticketId, body }) {
				await tracker.postComment(ticketId, body);
				return { ok: true as const };
			},
		}),

		wayfinder_close_ticket: defineTool({
			name: "wayfinder_close_ticket",
			description: "Close a resolved Wayfinder ticket.",
			input: TicketIdInputSchema,
			output: LocalTicketOutputSchema,
			run: ({ ticketId }) => tracker.closeTicket(ticketId),
		}),

		wayfinder_update_map: defineTool({
			name: "wayfinder_update_map",
			description:
				"Update a Wayfinder map by appending a decision summary to Decisions so far.",
			input: UpdateMapInputSchema,
			output: LocalMapOutputSchema,
			run: ({ mapId, decision }) => tracker.recordDecision(mapId, decision),
		}),

		wayfinder_wire_blocking: defineTool({
			name: "wayfinder_wire_blocking",
			description: "Mark one Wayfinder ticket as blocked by another ticket.",
			input: WireBlockingInputSchema,
			output: LocalTicketOutputSchema,
			run: ({ ticketId, blockerId }) =>
				tracker.addBlockingDependency(ticketId, blockerId),
		}),

		wayfinder_list_children: defineTool({
			name: "wayfinder_list_children",
			description: "List child tickets under a Wayfinder map.",
			input: MapIdInputSchema,
			output: TicketListOutputSchema,
			run: ({ mapId }) => tracker.listChildTickets(mapId),
		}),
	};
}
