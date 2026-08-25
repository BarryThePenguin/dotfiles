/**
 * CLI-facing binding for a `doist-core` validation schema.
 *
 * `input-validation.ts` owns validation (including `LIMITS` caps); this
 * module only bridges citty's string-typed, kebab-case args onto that same
 * schema, so a CLI command never redeclares the fields it already validates.
 * MCP tools need no equivalent — JSON-RPC input is already typed and
 * camelCase, so they import the schema directly (see `doist-mcp/tools/tasks.ts`).
 */

import * as v from "valibot";

export type CliCoercion = "number" | "csv";

export interface CliFieldSpec {
	/** Declared as a citty positional arg instead of a `--flag`. */
	positional?: boolean;
	/** Passed through to citty's arg definition. */
	required?: boolean;
	description: string;
	/**
	 * citty always hands args back as strings (booleans excepted). `"number"`
	 * runs `Number(value)` before validation; `"csv"` splits a comma-separated
	 * string into a trimmed, non-empty array (or `undefined` if empty).
	 */
	coerce?: CliCoercion;
	/**
	 * The raw CLI arg name, when it differs from the schema's field name
	 * (e.g. `parent` on the CLI vs `parentId` in `AddTaskFieldsSchema`, or
	 * `label` vs `labels`). Defaults to the kebab-case of the field name for
	 * flags, or the field name itself for positionals.
	 */
	aliasFrom?: string;
}

export interface CliArgDef {
	type: "positional" | "string" | "boolean";
	description: string;
	required?: boolean;
}

export interface CliFieldSet<TOutput> {
	/** Spread directly into a citty `defineCommand({ args: {...} })` block. */
	args: Record<string, CliArgDef>;
	/**
	 * Takes citty's raw `args` object, applies aliasing and coercion, then
	 * validates through the same schema (and therefore the same `LIMITS`
	 * caps) MCP uses. Throws `v.ValiError` on invalid input.
	 */
	read(raw: Record<string, unknown>): TOutput;
}

function toKebabCase(name: string): string {
	return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function parseCsv(value: string): string[] | undefined {
	const items = value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

/** Unwraps optional/nullable/exact-optional wrappers to find the base schema type. */
function baseType(schema: unknown): string | undefined {
	let current = schema as { type?: string; wrapped?: unknown } | undefined;
	while (current?.wrapped !== undefined) {
		current = current.wrapped as typeof current;
	}
	return current?.type;
}

export function defineCliFields<
	TSchema extends v.ObjectSchema<v.ObjectEntries, undefined>,
>(
	schema: TSchema,
	specs: Partial<Record<keyof v.InferInput<TSchema>, CliFieldSpec>>,
): CliFieldSet<v.InferOutput<TSchema>> {
	const entries = Object.entries(specs) as [string, CliFieldSpec][];
	const args: Record<string, CliArgDef> = {};
	const argKeys = new Map<string, string>();

	for (const [field, spec] of entries) {
		const argKey =
			spec.aliasFrom ?? (spec.positional ? field : toKebabCase(field));
		argKeys.set(field, argKey);

		const isBoolean = baseType(schema.entries[field]) === "boolean";
		args[argKey] = {
			type: spec.positional ? "positional" : isBoolean ? "boolean" : "string",
			description: spec.description,
			...(spec.required ? { required: true } : {}),
		};
	}

	return {
		args,
		read(raw) {
			const mapped: Record<string, unknown> = {};
			for (const [field, spec] of entries) {
				const value = raw[argKeys.get(field) as string];
				if (value === undefined || value === "") {
					continue;
				}
				mapped[field] =
					spec.coerce === "number"
						? Number(value)
						: spec.coerce === "csv"
							? parseCsv(value as string)
							: value;
			}
			return v.parse(schema, mapped);
		},
	};
}
