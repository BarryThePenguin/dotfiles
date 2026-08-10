/**
 * Execution modes supported by the subagent contract.
 *
 * The extension intentionally supports only independent delegation (single and
 * parallel). Sequential workflows are owned by the calling skill or session;
 * they are not part of this tool's contract.
 */
export const SUPPORTED_MODES = ["single", "parallel"] as const;

export type SubagentMode = (typeof SUPPORTED_MODES)[number];

export interface ModeParams {
	agent?: string;
	task?: string;
	tasks?: readonly { agent: string; task: string }[];
}

/** Return the execution modes represented by a tool call. */
export function getRequestedModes(params: ModeParams): SubagentMode[] {
	const modes: SubagentMode[] = [];
	if (params.agent && params.task) {modes.push("single");}
	if (params.tasks && params.tasks.length > 0) {modes.push("parallel");}
	return modes;
}
