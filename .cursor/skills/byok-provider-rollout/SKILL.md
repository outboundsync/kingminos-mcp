---
name: byok-provider-rollout
description: >-
  Roll out one KingMinos BYOK data-provider integration across kingminos-application,
  kingminos-website, kingminos-mcp, and kingminos-skills. Use when adding a new
  opt-in vendor (Apollo/Prospeo-shaped), wiring Your Keys, provider enums, or
  fixing BYOK/house-key copy drift. Prefer over ad-hoc multi-repo edits.
---

# BYOK provider rollout (KingMinos)

Mechanical four-repo rollout for **one** BYOK vendor. Optimized for cheap agents: follow checklists; do not invent policy.

**Golden path:** Apollo — `kingminos-application` #158, `kingminos-website` #34, `kingminos-skills` #6, `kingminos-mcp` #10. Prior: Prospeo (app main, website #33, skills #4, mcp #8).

In-repo plan example: `kingminos-application/docs/future/apollo-byok-four-repos.md`. Sibling repos: **application** (enums + adapter), **website** (Your Keys + MDX), **skills** (`providers.yaml` + skill copy).

Prefer `gh pr view` / `gh pr diff` / `gh api repos/…/contents/…` over cloning whole trees.

## Required inputs

Stop if any are missing:

| Input | Notes |
| --- | --- |
| `provider_id` | lowercase stable id (`apollo`, `prospeo`) |
| Display label | UI / docs string |
| Auth | header scheme (`bearer`, `x-token`, `x-api-key`, or vendor-specific inline) |
| Base URL + docs URL | vendor API root |
| Endpoints + capability | e.g. domain enrich → `company.resolve` only |
| Credential shape | usually `{ apiKey }`; ZoomInfo is OAuth exception |
| Verify call | real auth/credits/health endpoint + reject signals |
| Credits + billingMode | `on_success` or `always` |
| Compliance row | `soc2` / `data` evidence URLs if known |
| Scope cuts | what **not** to build (employment, phone reveal, name search, etc.) |

## Hard rules

1. **House keys cleared:** LeadMagic, Wiza, Findymail, AI Ark. New vendor = BYOK-only (`resaleAllowed: false`). Do **not** add to `HOUSE_KEY_RESALE_OS_PROVIDERS` in `kingminos-application/src/credentials.ts` unless counsel signs resale.
2. Dogfood `VENDOR_API_KEY` for tenant `default` is OK; that is **not** house resale.
3. **BuiltWith** stays BYOK-only (ToS / reseller parked); tenant cache isolation; never customer house.
4. Never put BYOK vendors on default routing (`field-stacks`). Opt-in via `routing.only` after `presetProvidersFor`.
5. Do **not** merge closed House Keys PR `kingminos-application` #132 wholesale.
6. Say **SFDC**, never “SF”.
7. No secrets, KEKs, or live API keys in commits or this skill.
8. Merge ≠ live: API Worker `kingminos-api-prod`, website Worker `kingminos-runtime`, MCP Worker `kingminos-mcp-prod` each need deploy/redeploy.

## Order

1. **application** → PR → merge → redeploy `kingminos-api-prod`
2. **website** (Your Keys + docs)
3. **mcp** (Zod + inventory pin)
4. **skills** (`providers.yaml` + copy + version bumps)
5. Redeploy website/MCP if auto-deploy did not run
6. Smoke tests below

Branch: `{provider_id}-byok`. One PR per repo. Squash merge when green.

## Checklist — `kingminos-application`

Copy shape from `src/providers/apollo.ts` or `src/providers/prospeo.ts`.

**Add**
- `src/providers/{id}.ts`
- `tests/{id}.test.ts` + `tests/fixtures/{id}-*.json`

**Edit**
- `src/types.ts` — `PROVIDER_NAMES`, `API_KEY_PROVIDER_NAMES`
- `src/credit-estimates.ts`
- `src/providers/registry.ts` — descriptor + `PROVIDERS`
- `src/providers/index.ts`
- `src/providers/api-key-company.ts` — scheme / `readRateLimit` if needed
- `src/providers/credential-verify.ts`
- `src/credentials.ts` — hint + dogfood env map (not house-resale set)
- `src/os-credentials.ts`, `src/credential-store.ts`
- `src/capabilities/registry.ts` — hop
- `src/routing/presets.ts` — **`presetProvidersFor(capability)`** (mandatory)
- Exhaustiveness: `src/capabilities/company-resolve.ts`, `person-verify-employment.ts`
- `src/compliance/matrix.ts`, `src/uptime/mapping.ts`, `src/explain.ts`, `src/resolve-cache.ts`
- `cli/const.ts` (+ help/docs as needed)
- `openapi.yaml`, `openapi.es.yaml` — enums + `{id}_credentials_required` on the **correct** capability 400 list only
- `.dev.vars.example`, `worker-configuration.d.ts`
- Docs: `docs/byok-zoominfo.md`, `docs/os-router-credentials.md`, `README.md`
- Pinned tests: `tests/fitness.test.ts`, `opt-in-providers.test.ts`, `credentials.test.ts`, `app.test.ts`, `compliance.test.ts`, `routing.test.ts`, `live-dev-vars.ts`, peers

**Skip:** `src/routing/field-stacks.ts`; `HOUSE_KEY_RESALE_OS_PROVIDERS` unless explicitly ordered as house resale.

**Verify:** `npm run check:types && npm run lint && npm test && npm run check:surfaces`

## Checklist — `kingminos-website`

- `src/lib/credentials.ts` — provider in `CREDENTIAL_PROVIDERS` / `CREDENTIAL_VENDORS` with `house: false`
- `src/lib/credentials.test.ts` (and ui tests if present)
- Docs: `src/content/docs/docs/api/credentials.mdx`, capability MDX, `docs/mcp`, `docs/skills`, `docs/cli`
- `scripts/check-agent-surfaces.mjs` if it pins catalog copy

House-key prose: LeadMagic, Wiza, Findymail, AI Ark = house (optional BYOK override); ZoomInfo, BuiltWith, Prospeo, Apollo, **new id** = BYOK-only.

**Verify:** `npm run check:session && npm run lint && npm run check:types && npm run build && npm run check:agent`  
**Deploy:** `kingminos-runtime`.

## Checklist — `kingminos-mcp`

- `src/schemas.ts` — `PROVIDER_NAME_VALUES` + `CREDENTIAL_PROVIDER_VALUES` (+ describes). Functional for `routing.only` / `put_credentials`.
- `inventory/openapi-surfaces.json` — `providers[]` + `credentialProviders[]` (or `npm run inventory:refresh` after API live)
- `src/server.ts`, `README.md` prose
- Format: `npx --yes @biomejs/biome@1.9.4 check --write .`

**Verify:** `npm run typecheck && npm run check:surfaces && npm run check:providers && npm test`  
**Deploy:** `kingminos-mcp-prod`.

## Checklist — `kingminos-skills`

- `scripts/validate/fixtures/providers.yaml` — `supply: byok`, `credentials_required`, `path_enum`, `api_key`
- `scripts/validate/fixtures/openapi-inventory.yaml` if credential enum pinned
- `skills/credentials/**` and touched capability skills (e.g. `skills/company-resolve/**`)
- `README.md`, `CONVENTIONS.md`, `SECURITY.md`
- Bump skill `metadata.version` from tip + `CHANGELOG.md`

**Verify:** `npm run validate && node scripts/validate/cli.mjs --base origin/main && npm test`

## Patterns that are rename-copy

| Concern | Pattern |
| --- | --- |
| Domain-only company hop | `searchByDomain` implemented; `searchByName` → `unsupportedEmptyResult` |
| Evidence fields | land in `CompanyCandidate.extra` only |
| Auth helpers | `apiKeyHeaders`: `bearer` \| `x-token` \| `x-api-key`; else inline (Prospeo `X-KEY`, BuiltWith `Authorization: API`) |
| Opt-in | capability registry hop + `presetProvidersFor` |
| Refuse error | `{id}_credentials_required` on matching OpenAPI 400 list |

## Traps

High-signal:

- Missing `presetProvidersFor` → `routing.only` 400 `invalid_routing` (Prospeo / AI Ark).
- Stale “LeadMagic only house-key” copy after Wiza/Findymail house (#156).
- Provider-enum CI: mcp `check:providers`, skills `provider-enum` — update pins in-PR.
- Wrong capability’s 400 list for `*_credentials_required` (#157).
- Verify: map vendor 400/422 rejects via `rejectedOn` or they become 503.
- mcp Biome 1.9.4 wrap churn; skills version must bump from tip.
- Live OpenAPI lags until `kingminos-api-prod` redeploy.

## Smoke / acceptance

1. Live OpenAPI lists `{provider_id}` after API redeploy.
2. `PUT /v1/credentials/{provider_id}` with bad key → `credential_rejected` (not verify 503).
3. `POST` capability with `routing.only: ["{provider_id}"]` works when keyed; missing key → `{id}_credentials_required`.
4. Same call **without** `routing.only` does not use the vendor on default paths.
5. All four repo verify commands green; website + MCP Workers redeployed.

## Minimal agent prompt

```
Add BYOK provider [{provider_id}] using skill byok-provider-rollout.
Auth [{…}]; docs [{…}];
endpoints [{…}]; capability [{…}]; verify [{…}]; credits [{…}].
API first → website → mcp → skills. resaleAllowed false; presetProvidersFor;
no default routing; no HOUSE_KEY_RESALE; SFDC not SF; no secrets.
Branch [{provider_id}-byok]. Return four PRs + verify output.
```
