import * as v from "valibot";

export const TicketTypeSchema = v.picklist([
	"research",
	"prototype",
	"grilling",
	"task",
] as const);
export type TicketType = v.InferOutput<typeof TicketTypeSchema>;

export const DecisionSummarySchema = v.object({
	title: v.string(),
	url: v.string(),
	gist: v.string(),
});
export type DecisionSummary = v.InferOutput<typeof DecisionSummarySchema>;

export const OutOfScopeEntrySchema = v.object({
	text: v.string(),
	reason: v.string(),
	url: v.optional(v.string()),
});
export type OutOfScopeEntry = v.InferOutput<typeof OutOfScopeEntrySchema>;

export const ParsedMapBodySchema = v.object({
	destination: v.string(),
	notes: v.string(),
	decisionsSoFar: v.array(DecisionSummarySchema),
	notYetSpecified: v.array(v.string()),
	outOfScope: v.array(OutOfScopeEntrySchema),
});
export type ParsedMapBody = v.InferOutput<typeof ParsedMapBodySchema>;

export const RenderMapBodyInputSchema = ParsedMapBodySchema;
export type RenderMapBodyInput = ParsedMapBody;

export const ParsedTicketBodySchema = v.object({
	question: v.string(),
	mapId: v.optional(v.string()),
	blockerIds: v.array(v.string()),
	claimedBy: v.optional(v.string()),
});
export type ParsedTicketBody = v.InferOutput<typeof ParsedTicketBodySchema>;

export const RenderTicketBodyInputSchema = ParsedTicketBodySchema;
export type RenderTicketBodyInput = ParsedTicketBody;

export const WayfinderMapSchema = v.object({
	id: v.string(),
	title: v.string(),
	...ParsedMapBodySchema.entries,
});
export type WayfinderMap = v.InferOutput<typeof WayfinderMapSchema>;

export const WayfinderTicketSchema = v.object({
	id: v.string(),
	mapId: v.string(),
	title: v.string(),
	type: TicketTypeSchema,
	question: v.string(),
	blockerIds: v.array(v.string()),
	claimedBy: v.optional(v.string()),
});
export type WayfinderTicket = v.InferOutput<typeof WayfinderTicketSchema>;
