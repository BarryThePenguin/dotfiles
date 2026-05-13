import * as v from "valibot";

const EnvSchema = v.object({
	TODOIST_API_TOKEN: v.string(),
	TODOIST_DB_PATH: v.optional(v.string()),
	TODOIST_RC_PATH: v.optional(v.string()),
});

const parseEnv = v.parser(EnvSchema);

export const env = parseEnv(process.env);
