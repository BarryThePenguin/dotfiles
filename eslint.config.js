import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";

export default defineConfig([
	globalIgnores(["**/coverage", "**/dist", "**/stow"]),
	{
		files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
		plugins: { js },
		extends: ["js/recommended"],
		languageOptions: { globals: globals.node },
	},
	{
		extends: [
			tseslint.configs.recommendedTypeChecked,
			tseslint.configs.strictTypeChecked,
		],
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
		rules: {
			"@typescript-eslint/restrict-template-expressions": [
				"error",
				{
					allow: [{ name: ["Error", "URL", "URLSearchParams"], from: "lib" }],
					allowAny: true,
					allowBoolean: true,
					allowNullish: true,
					allowNumber: true,
					allowRegExp: true,
				},
			],
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "all",
					argsIgnorePattern: "^_",
					caughtErrors: "all",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],
			curly: ["error", "all"],
		},
	},
	{
		files: ["**/*.test.ts"],
		extends: [vitest.configs.recommended],
		settings: {
			vitest: {
				typecheck: true,
			},
		},
		rules: {
			"@typescript-eslint/unbound-method": "off",
		},
	},
]);
