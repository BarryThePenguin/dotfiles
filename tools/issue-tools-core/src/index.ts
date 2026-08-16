/**
 * The public surface of issue-tools-core.
 *
 * This list is the package's deliberate interface — every name here is a
 * promise. It is enumerated explicitly (not `export *`) so the surface is
 * reviewable in one screen and dead exports can't quietly re-enter the
 * package boundary. The mdast builders, the markdown document, the format
 * render/parse functions, the doist-core passthroughs, and the persistence
 * capability interfaces are internal to this package — consumers reach the
 * domain through the modules, records, and renderers below.
 */

// -- Issue domain --------------------------------------------------------

export type {
	CreateIssueInput,
	Issue,
	IssueComment,
	IssueStatus,
	IssueTracker,
	ListIssuesFilter,
	UpdateIssueLabelsInput,
} from "./issue.ts";

// -- Wayfinder domain -----------------------------------------------------

export {
	BlockerNotOnMapError,
	ClosedTicketWithoutResolutionError,
} from "./tracker.ts";
export type {
	BlockedFrontierTicket,
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	FrontierInspection,
	ResolveOutcome,
	ResolveTicketInput,
	ResolveTicketResult,
	WayfinderBlockerDetail,
	WayfinderClaimResult,
	WayfinderMapDetail,
	WayfinderTicketDetail,
	WayfinderTicketStatus,
	WayfinderTracker,
	WayfinderTrackerMap,
	WayfinderTrackerReference,
	WayfinderTrackerTicket,
} from "./tracker.ts";

// -- Domain records -------------------------------------------------------

export type {
	DecisionSummary,
	MapSectionKey,
	OutOfScopeEntry,
	ParsedMapBody,
	TicketType,
	WayfinderTicket,
} from "./schema.ts";

// -- Tracker modules ------------------------------------------------------

export { createLocalTrackerModules } from "./local-tracker-factory.ts";
export type { TrackerModules } from "./modules.ts";
export {
	createTodoistTrackerModules,
	selectTodoistRepoProjectId,
} from "./todoist-tracker-factory.ts";

// -- Response renderers ---------------------------------------------------

export {
	renderIssueDetails,
	renderMapSummary,
	renderResolution,
	renderTicketDetails,
	stripPrefix,
} from "./responses.ts";

// -- Session lifecycle ----------------------------------------------------

export { resolveClaimant } from "./claimant.ts";
export { createTrackerSession, localTrackerRoot } from "./session.ts";
export type {
	TrackerMode,
	TrackerSession,
	TrackerSessionOptions,
} from "./session.ts";

// -- Setup ----------------------------------------------------------------

export { detectTrackerSelection } from "./setup-issue-tracker.ts";
export type { TrackerSelection } from "./setup-issue-tracker.ts";

// -- Action handlers (framework-agnostic) ---------------------------------

export { handleAction } from "./actions.ts";
export type { ActionMap, ActionRuntime } from "./actions.ts";
export { createActionRuntime } from "./action-runtime.ts";
export type { ActionRuntimeOptions } from "./action-runtime.ts";

// -- Tool parameter schemas (host-agnostic JSON Schema) --------------------

export {
	chartParams,
	claimParams,
	createTicketParams,
	getMapParams,
	getTicketParams,
	issueCloseParams,
	issueCommentParams,
	issueCreateParams,
	issueIdOrUrl,
	issueLabelParams,
	issueListParams,
	issueReadParams,
	listFrontierParams,
	listMapsParams,
	mapId,
	mapSectionSchema,
	resolveParams,
	setBlockingParams,
	ticketId,
	ticketTypeSchema,
	updateMapParams,
} from "./tool-schemas.ts";
export type {
	ChartParams,
	ClaimParams,
	CreateTicketParams,
	GetMapParams,
	GetTicketParams,
	IssueCloseParams,
	IssueCommentParams,
	IssueCreateParams,
	IssueIdOrUrl,
	IssueLabelParams,
	IssueListParams,
	IssueReadParams,
	ListFrontierParams,
	ListMapsParams,
	MapId,
	ResolveParams,
	SetBlockingParams,
	TicketId,
	UpdateMapParams,
} from "./tool-schemas.ts";

// -- Tool catalog (registered surface) -------------------------------------

export {
	issueClose,
	issueComment,
	issueCreate,
	issueLabel,
	issueList,
	issueRead,
	toolCatalog,
	wayfinderChart,
	wayfinderClaim,
	wayfinderCreateTicket,
	wayfinderGetMap,
	wayfinderGetTicket,
	wayfinderListFrontier,
	wayfinderListMaps,
	wayfinderResolve,
	wayfinderSetBlocking,
	wayfinderUpdateMap,
} from "./tool-catalog.ts";
export type { ToolCatalogEntry } from "./tool-catalog.ts";
