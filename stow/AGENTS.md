# AGENTS.md

## Node Dependencies

Always use `aube` to install node dependencies instead of calling package managers (npm, pnpm, yarn, bun) directly. See https://aube.jdx.dev/

Use `aube exec` (or the shorthand `aubx`) to execute local binaries (e.g. `aubx tsc`, `aubx vitest`) instead of `npx`, `pnpm exec`, or direct `node_modules/.bin/` paths.

Use `aube run` (or the shorthand `aubr`) to run package.json scripts instead of `npm run`, `pnpm run`, etc.
