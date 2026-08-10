import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Environment override keys for the dev driving a Wayfinder map. Both
 * frontends (Pi, opencode) honor the same pair so a shared checkout picks one
 * identity regardless of which extension loads it.
 */
const CLAIMANT_ENVS = [
	"OPENCODE_ISSUE_TOOLS_CLAIMANT",
	"PI_ISSUE_TOOLS_CLAIMANT",
];

/**
 * Resolve the dev driving the map. The environment override is useful when a
 * tracker identity differs from the repository's Git identity; Git config is
 * the normal local source, with the OS login as a last fallback.
 */
export async function resolveClaimant(cwd: string): Promise<string> {
	for (const key of CLAIMANT_ENVS) {
		const configured = process.env[key]?.trim();
		if (configured) {
			return configured;
		}
	}

	try {
		const { stdout } = await execFileAsync(
			"git",
			["config", "--get", "user.name"],
			{ cwd },
		);
		const gitName = stdout.trim();
		if (gitName) {
			return gitName;
		}
	} catch {
		// Fall through when the cwd is not a Git repository or has no user.name.
	}

	return (
		process.env["USER"]?.trim() ||
		process.env["LOGNAME"]?.trim() ||
		"unknown-dev"
	);
}
