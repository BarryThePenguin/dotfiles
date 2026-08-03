/**
 * The public surface of issue-tools-core.
 *
 * This list is the package's deliberate interface — every name here is a
 * promise. It is enumerated explicitly (not `export *`) so the surface is
 * reviewable in one screen and dead exports can't quietly re-enter the
 * package boundary. When adding a symbol, decide consciously whether it
 * belongs here.
 */

// -- doist-core passthrough ----------------------------------------------

export {
	applyRepoMarker,
	createContainer,
	Database,
	mergeLabels,
	selectRepoProject,
	syncAndPersist,
} from "doist-core";
export type { Container, TodoistClient } from "doist-core";

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

export { filterIssues } from "./issue-filter.ts";

// -- Wayfinder domain -----------------------------------------------------

export type {
	BlockedFrontierTicket,
	CreateWayfinderChildTicketInput,
	CreateWayfinderMapInput,
	FrontierInspection,
	ResolveOutcome,
	ResolveTicketInput,
	ResolveTicketResult,
	WayfinderClaimResult,
	WayfinderTracker,
	WayfinderTrackerMap,
	WayfinderTrackerTicket,
	WayfinderTicketStatus,
} from "./tracker.ts";
export { ClosedTicketWithoutResolutionError, BlockerNotOnMapError } from "./tracker.ts";

// -- Domain modules -------------------------------------------------------

export { createTrackerModules, IssueModule, WayfinderModule } from "./modules.ts";
export type {
	IssuePersistence,
	TrackerModules,
	TrackerPersistence,
	WayfinderPersistence,
} from "./modules.ts";

// -- Wayfinder operations -------------------------------------------------

export {
	addBlockingDependency,
	canClaimTicket,
	partitionOpenTickets,
} from "./tracker-operations.ts";

// -- Persistence adapters --------------------------------------------------

export { LocalMarkdownPersistenceAdapter } from "./local-markdown-adapter.ts";

export { TodoistPersistenceAdapter } from "./todoist-adapter.ts";
export type {
	TodoistCreateTaskInput,
	TodoistGateway,
	TodoistListTasksInput,
	TodoistPersistenceAdapterOptions,
	TodoistTask,
	TodoistTaskComment,
	TodoistUpdateTaskInput,
} from "./todoist-adapter.ts";

export { DoistCoreTodoistGateway } from "./doist-core-gateway.ts";
export type { DoistCoreTodoistGatewayOptions } from "./doist-core-gateway.ts";

// -- Map and ticket formats ----------------------------------------------

export {
	mapBodyFromDocument,
	parseMapBody,
	renderMapBody,
	replaceMapSection,
} from "./map-body.ts";
export type { MapBodyRootInput, MapSectionKey } from "./map-body.ts";

export {
	parseTicketBody,
	renderTicketBody,
	setBlockedBySection,
	setBlockedBySectionOnRoot,
	setClaimedBy,
	setClaimedByOnRoot,
	ticketBodyFromDocument,
	ticketBodyRoot,
} from "./ticket-body.ts";

export { issueFileBodyFromDocument, issueFileBodyFromMarkdown, issueMarkdown } from "./issue-file-format.ts";
export type { IssueFileBody } from "./issue-file-format.ts";

export {
	compareTicketIds,
	mapFileUrl,
	mapMarkdown,
	normalizeTicketIdForMap,
	slugify,
	stripResolutionHeading,
	ticketFileBodyFromDocument,
	ticketFileUrl,
	ticketMarkdown,
	ticketNumberFromRef,
	ticketRefFromId,
	titleFromSlug,
} from "./local-file-format.ts";
export type { LocalTicketFileBody } from "./local-file-format.ts";

export {
	markdownDocument,
	markdownDocumentFromRoot,
	setHeaderOnRoot,
} from "./wayfinder-markdown.ts";
export type {
	WayfinderMarkdownDocument,
	WayfinderMarkdownHeader,
	WayfinderMarkdownIndex,
	WayfinderMarkdownSection,
} from "./wayfinder-markdown.ts";

// -- Markdown builders ----------------------------------------------------

export {
	blockquote,
	heading,
	link,
	list,
	listItem,
	listItems,
	listItemTexts,
	markdownBlocks,
	markdownBlockGroups,
	paragraph,
	parseMarkdown,
	stringifyChildren,
	stringifyMarkdown,
	strong,
	text,
} from "./markdown.ts";

// -- Labels ---------------------------------------------------------------

export {
	TODOIST_TICKET_TYPE_LABELS,
	WAYFINDER_MAP_LABEL,
	ticketTypeToTodoistLabel,
	todoistLabelToTicketType,
} from "./labels.ts";
export type { TodoistWayfinderTicketLabel } from "./labels.ts";

// -- Setup ----------------------------------------------------------------

export { detectSetupMode, extensionToolCount, toolInventory } from "./setup-issue-tracker.ts";
export type { SetupMode, ToolInventoryEntry } from "./setup-issue-tracker.ts";

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
	IssueIdOrUrl,
	IssueLabelParams,
	IssueListParams,
	IssueReadParams,
	ListFrontierParams,
	ListMapsParams,
	MapId,
	MapSectionSchema,
	PiIssueToolNames,
	PiToolNames,
	PiWayfinderToolNames,
	ResolveParams,
	SetBlockingParams,
	TICKET_TYPES,
	TicketId,
	TicketTypeSchema,
	UpdateMapParams,
} from "./schema.ts";
export type {
	BlockerLink,
	DecisionSummary,
	MapSection,
	OutOfScopeEntry,
	ParsedMapBody,
	ParsedTicketBody,
	RenderMapBodyInput,
	TicketType,
	WayfinderTicket,
} from "./schema.ts";
