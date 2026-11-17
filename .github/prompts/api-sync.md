# Update the KingMinos MCP tools after an API spec change

You run inside the `API sync` workflow. The live KingMinos OpenAPI spec (`https://api.kingminos.com/openapi.json`) changed, or this is the first run. Your job is to bring the MCP tools in this repo in line with it. A later step commits the result and opens a pull request that a human reviews and merges; merging deploys the MCP server.

The workflow message tells you the mode:

- **update:** the previous spec is `api-sync/openapi.snapshot.json`. Work only on what changed.
- **bootstrap:** there is no previous snapshot. Audit every tool against the whole spec and fix real mismatches.

## What changed

- `api-sync/openapi.live.json` is the new spec (canonical JSON, sorted keys). In update mode, `git diff --no-index api-sync/openapi.snapshot.json api-sync/openapi.live.json` shows what changed in the API.
- `inventory/openapi-surfaces.json` was already refreshed from the new spec. `git diff -- inventory/openapi-surfaces.json` shows added or removed tool operations (`operations[]`, tool names already snake_case), new provider enum values (`providers[]`, `credentialProviders[]`) and newly excluded operationIds.
- `npm run check:surfaces` lists missing and extra tools and routes. `npm run check:providers` lists missing and extra provider enum values. Both compare the code with the refreshed inventory.

## What to update

Only edit files under `src/` and `test/`, and the tool sections of `README.md`.

- **New operation in `operations[]`:** add one tool, named exactly as the inventory's `operationId` (the snake_case of the API's `operationId`: dots become `_`, every capital after the first character starts a new `_` word, e.g. `companyXAccount` → `company_x_account`). Model it on the most similar existing tool:
  - `src/catalog.ts`: add the name to the `ToolName` union and a `LIVE_RESOURCE_ROUTES` row (method, path with `{param}` names as in the spec, tool).
  - `src/schemas.ts`: a Zod input shape built from the operation's parameters and request body in the spec (required fields, enums, limits, descriptions).
  - `src/server.ts`: a `TOOL_SPECS` entry (`title`, `description`, `inputSchema`, `annotations`, `buildRequest`). Pick annotations from the existing constants by what the call does (read, lookup, write, destroy). Descriptions say what the agent gets back and what it costs, in the style of the neighbouring tools.
  - Tests that list every tool: `EXPECTED_TOOLS` in `src/check-surfaces.test.ts`, `EXPECTED_TITLES` in `src/directory-hygiene.test.ts`, the per-tool sample arguments in `src/server.test.ts`, plus any other test that `npm test` shows failing.
  - `README.md`: a row in the `## Tools` table, in the same order as `LIVE_RESOURCE_ROUTES`. If the tool changes workspace state, add it to the "Confirm … with the user" sentence under the table.
- **Operation removed from `operations[]`:** remove its tool from all of the places above.
- **Changed request or response for an existing tool** (new or removed fields, enums, required fields, limits, path or query parameters, behaviour the description states): update that tool's Zod shape, `buildRequest`, description and README row.
- **Feedback capability ids:** `FEEDBACK_CAPABILITY_VALUES` in `src/schemas.ts` (the `capability` field of `submit_feedback`) must include every value of the spec's `FeedbackCreate.capability` enum, and the dotted capability id (as in `company.icon`) of any capability operation you add. Add missing values; don't remove existing ones, but list any the spec doesn't have in your summary.
- **New provider in `providers[]` or `credentialProviders[]`:** add it to `PROVIDER_NAME_VALUES` and/or `CREDENTIAL_PROVIDER_VALUES` in `src/schemas.ts` (in the pin's order). Credential-only vendors go in `CREDENTIAL_PROVIDER_VALUES` only. Add it to `OAUTH_CREDENTIAL_PROVIDER_VALUES` only if the spec says it stores OAuth client credentials.
- **Bootstrap mode:** also compare every existing tool with its operation in the spec (parameters, request body, enums, required fields) and fix real mismatches. Don't rewrite descriptions that are still accurate.

Do not edit:

- `inventory/**` and `api-sync/**` (the workflow writes them), `.github/**`, `.cursor/**`, `scripts/**`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `server.json`, `biome.json`, `tsconfig.json`, `Dockerfile`, `fly.example.toml`.
- `VERSION` in `src/config.ts`. Releases are tagged separately; sync PRs don't bump versions.
- `src/admin-tools.ts`. Admin tools are hand-written for `kmadm_` tokens and are not OpenAPI resource tools.

## Rules

- Read `README.md` first (the `## Tools` table and the contract-check sections) and follow its conventions. Say **SFDC**, never SF.
- **Do not add account/auth MCP tools.** Operations under `/v1/auth/*`, `/v1/account/*` and `/v1/admin/*`, and every operationId in the inventory's `excludedOperationIds`, are deliberately not tools, even when the spec lists them. Never edit the deny-lists.
- Describe only what the spec says. Never invent endpoints, tools, fields, enum values, prices or limits. If the spec is ambiguous, leave the code as it is and say so in your summary.
- One tool per operation, named by the rule above. Never rename an existing tool unless its operation's `operationId` changed in the spec.
- If the change doesn't affect any tool (for example only a description or an example in the spec changed), change nothing.
- Don't commit, push, create branches or open pull requests.
- When you're done, run `npm run typecheck`, `npm run lint` (`npm run format` fixes formatting), `npm run check:surfaces`, `npm run check:providers`, `npm test` and `npm run smoke`, and fix anything they report in the files you may edit.
- End your last message with a line that starts `Summary:`, followed by a short plain-text summary: which tools you added, removed or changed and why, which checks still fail and why, and anything a human should check. The workflow puts it in the pull request.
