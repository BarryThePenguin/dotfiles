/**
 * The public surface of issue-tools-core.
 *
 * This list is the package's deliberate interface — every name here is a
 * promise. It is enumerated explicitly (not `export *`) so the surface is
 * reviewable in one screen and dead exports can't quietly re-enter the
 * package boundary. The mdast builders, the markdown document, the format
 * render/parse functions, the doist-core passthroughs, and the persistence
 * capability interfaces are internal to this package — consumers reach the
 * domain through the modules, adapters, records, and renderers below.
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
	WayfinderTracker,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
	WayfinderTicketStatus,
} from "./tracker.ts";
export {
	ClosedTicketWithoutResolutionError,
	BlockerNotOnMapError,
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

export { createTrackerModules } from "./modules.ts";
export type { TrackerModules } from "./modules.ts";

// -- Persistence adapters --------------------------------------------------

export { LocalMarkdownPersistenceAdapter } from "./local-markdown-adapter.ts";

export { TodoistAdapter } from "./todoist-adapter.ts";
export type { TodoistAdapterOptions } from "./todoist-adapter.ts";

// -- Response renderers ---------------------------------------------------

export {
	renderIssueDetails,
	renderMapSummary,
	renderResolution,
	renderTicketDetails,
	stripPrefix,
} from "./responses.ts";

// -- Setup ----------------------------------------------------------------

export {
	detectTrackerSelection,
	extensionToolCount,
	toolInventory,
} from "./setup-issue-tracker.ts";
export type { ToolInventoryEntry, TrackerSelection } from "./setup-issue-tracker.ts";

// -- Tool parameter schemas (Pi surface) ----------------------------------

export {
	ChartParams,
	ClaimParams,
	CreateTicketParams,
	GetMapParams,
	GetTicketParams,
	IssueCloseParams,
	IssueCommentParams,
	IssueCreateParams,
	IssueLabelParams,
	IssueListParams,
	IssueReadParams,
	IssueIdOrUrl,
	ListFrontierParams,
	ListMapsParams,
	MapId,
	MapSectionSchema,
	PiIssueToolNames,
	PiToolNames,
	PiWayfinderToolNames,
	ResolveParams,
	SetBlockingParams,
	TicketId,
	TicketTypeSchema,
	UpdateMapParams,
} from "./tool-schemas.ts";
