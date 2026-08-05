import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLAIMANT_ENV = "PI_ISSUE_TOOLS_CLAIMANT";

/**
 * Resolve the dev driving the map. The environment override is useful when a
 * tracker identity differs from the repository's Git identity; Git config is
 * the normal local source, with the OS login as a last fallback.
 */
export async function resolveClaimant(cwd: string): Promise<string> {
	const configured = process.env[CLAIMANT_ENV]?.trim();
	if (configured) {
		return configured;
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
