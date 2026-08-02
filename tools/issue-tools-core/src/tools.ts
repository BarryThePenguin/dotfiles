import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { WayfinderTracker } from "./tracker.ts";
export type { WayfinderTracker } from "./tracker.ts";
import {
	ClaimTicketInputSchema,
	ClaimTicketOutputSchema,
	CreateMapInputSchema,
	CreateTicketInputSchema,
	LocalMapOutputSchema,
	LocalTicketOutputSchema,
	MapIdInputSchema,
	TicketIdInputSchema,
	TicketListOutputSchema,
	UpdateMapInputSchema,
	WireBlockingInputSchema,
	type WayfinderToolName,
} from "./schema.ts";

export { WayfinderToolNameSchema, type WayfinderToolName } from "./schema.ts";

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| {
			[key: string]: JsonValue;
	  };
type ToolInputSchema = TSchema;
type ToolOutputSchema = TSchema;
type ToolRunResult<S extends ToolOutputSchema | undefined> =
	S extends ToolOutputSchema ? Static<S> : JsonValue | undefined;
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
			? Static<TInput>
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

function parseWithSchema<S extends TSchema>(schema: S, value: unknown): Static<S> {
	return Value.Parse(schema, value);
}

function parseOutput<S extends ToolOutputSchema>(
	schema: S,
	value: unknown,
): ToolRunResult<S> {
	return parseWithSchema(schema, value) as ToolRunResult<S>;
}

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
			const parsedContext = input ? parseWithSchema(input, context) : context;
			const result = await run(parsedContext as Parameters<typeof run>[0]);

			if (output) {
				return parseOutput(output, result);
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
