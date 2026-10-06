# KingMinos BYOK provider rollout playbook

**Audience:** cheap DeepSeek (or similar) coding agents + humans reviewing them.  
**Golden path:** Apollo (2026-10-05) — app [#158](https://github.com/outboundsync/kingminos-application/pull/158), website [#34](https://github.com/outboundsync/kingminos-website/pull/34), skills [#6](https://github.com/outboundsync/kingminos-skills/pull/6), mcp [#10](https://github.com/outboundsync/kingminos-mcp/pull/10).  
**Prior same-day reference:** Prospeo (app main commits `6e4e41e` → `7fcc6c7`, website [#33](https://github.com/outboundsync/kingminos-website/pull/33), skills [#4](https://github.com/outboundsync/kingminos-skills/pull/4), mcp [#8](https://github.com/outboundsync/kingminos-mcp/pull/8)).  
**Plan artifact (Apollo):** `kingminos-application/docs/future/apollo-byok-four-repos.md`.

**Canonical copy (this repo):** `docs/byok-provider-playbook.md`. Cursor skill checklist: `.cursor/skills/byok-provider-rollout/SKILL.md`. Sibling repos follow the same rollout — application is source of truth for enums; website (Your Keys + docs), this MCP repo (Zod + inventory), and skills (`providers.yaml` + skill copy) are updated in lockstep.

**Goal:** add **one** paid data vendor as a **BYOK opt-in hop** (off every default routing path), then propagate enums/docs to website / MCP / skills. Do not invent House Keys. Prefer reading `gh pr diff` / `gh api …/contents/…` over full clones.

Always say **SFDC**, never “SF”, if Salesforce is mentioned.

---

## 0. House facts (do not drift)

| Fact | Rule |
| --- | --- |
| **House-key cleared** | **LeadMagic, Wiza, Findymail** only (`HOUSE_KEY_RESALE_OS_PROVIDERS` + website `house: true` / skills `supply: house_key`). |
| **Everything else** | **BYOK** until written reseller terms (`resaleAllowed: false`; do **not** add to `HOUSE_KEY_RESALE_OS_PROVIDERS`). |
| **Dogfood env hooks** | `VENDOR_API_KEY` on Worker for tenant `default` only is OK for internal dogfood (Prospeo/Apollo pattern). That is **not** house resale. |
| **BuiltWith** | Parked for customer House Keys (ToS). BYOK only; keep tenant cache isolation; never customer house. |
| **Default routing** | Never put a new BYOK vendor on `field-stacks` / product presets. Opt-in only via `routing.only` / explicit order after `presetProvidersFor` allowlists it. |
| **House Keys PR #132** | Closed — do **not** merge wholesale. House-key expansions use the narrow #156 pattern (Wiza/Findymail), not the full allowlist gate PR. |
| **Merge ≠ live** | Website: needs `kingminos-runtime` deploy (auto on `main` when GH Actions secrets set; otherwise manual wrangler). MCP: needs `kingminos-mcp-prod` redeploy. API: needs `kingminos-api-prod` redeploy before live OpenAPI/MCP live checks see the new provider. |
| **Cloud agents** | Cursor/Grok house models only when Agrippa launches them. This playbook is for DeepSeek agents Harris runs — follow steps mechanically; do not invent product policy. |

---

## 1. Inputs the agent must receive (before coding)

| Input | Example (Apollo) | Example (Prospeo) |
| --- | --- | --- |
| `provider_id` | `apollo` | `prospeo` |
| Display label | `Apollo` | `Prospeo` |
| Auth type | `x-api-key` header | custom `X-KEY` header |
| Docs / base URL | `https://api.apollo.io/api/v1` | `https://api.prospeo.io` |
| Primary endpoint | `GET /organizations/enrich?domain=` | `POST /enrich-company` body `{ data: { company_website } }` |
| Capability | `company.resolve` only | `company.resolve` only |
| Credential fields | `{ apiKey }` | `{ apiKey }` |
| Verify endpoint | `GET /auth/health` | `GET /account-information` (+ `rejectedOn` for `INVALID_API_KEY`) |
| Credits estimate | `1` on success | `1` on success (`0` if `free_enrichment`) |
| Compliance | `soc2: true, data: true` | vendor-specific row |
| Scope cuts | no employment hop | no mobile reveal; name-only → `unsupported_input` |

If auth scheme is not already in `apiKeyHeaders` (`bearer` \| `x-token` \| `x-api-key`), either add an arm **or** inline headers in the provider (Prospeo inlined `X-KEY`).

---

## 2. Order of operations (strict)

```
1) kingminos-application  → PR → merge → redeploy kingminos-api-prod
2) kingminos-website       → Your Keys catalog + docs (can parallel after app PR is up)
3) kingminos-mcp           → Zod enums + inventory pin (after app enums known; live refresh after API redeploy)
4) kingminos-skills        → providers.yaml + skill copy + version bumps
5) Redeploy                → kingminos-runtime (website) if Actions didn’t; kingminos-mcp-prod
6) Smoke                   → routing.only, PUT credentials validate, OpenAPI enum live
```

**Why API first:** satellites pin / copy the app’s provider + credential enums. App PR is source of truth.

Branch name convention: `{provider_id}-byok` (e.g. `apollo-byok`). Squash-merge; delete branch.

---

## 3. File touch checklists

### 3.1 `outboundsync/kingminos-application` (Apollo #158 as checklist)

**New files**
- [ ] `src/providers/{provider}.ts` — adapter (copy `prospeo.ts` / `apollo.ts`)
- [ ] `tests/{provider}.test.ts`
- [ ] `tests/fixtures/{provider}-*.json` (hit + no-match minimum)
- [ ] Optional plan: `docs/future/{provider}-byok-four-repos.md`

**Must edit (mechanical rename / wire)**
- [ ] `src/types.ts` — `PROVIDER_NAMES`, `API_KEY_PROVIDER_NAMES`
- [ ] `src/credit-estimates.ts` — credit constant
- [ ] `src/providers/registry.ts` — `*_DESCRIPTOR` (`auth: "api_key"`, `resaleAllowed: false`, ops), add to `PROVIDERS`
- [ ] `src/providers/index.ts` — construct provider
- [ ] `src/providers/api-key-company.ts` — auth scheme and/or `readRateLimit` branch if vendor-specific headers
- [ ] `src/providers/credential-verify.ts` — real vendor auth/account call + `rejectedOn` if non-401/403
- [ ] `src/credentials.ts` — refuse hint, `OS_API_KEY_HOUSE_ENV` dogfood hook — **do not** add to `HOUSE_KEY_RESALE_OS_PROVIDERS`
- [ ] `src/os-credentials.ts` — provider in OS API-key set
- [ ] `src/credential-store.ts` — storable provider
- [ ] `src/capabilities/registry.ts` — catalog hop for the capability
- [ ] `src/routing/presets.ts` — **`presetProvidersFor(capability)`** include id (critical)
- [ ] `src/capabilities/company-resolve.ts` and/or `person-verify-employment.ts` — `assertNever` exhaustiveness only
- [ ] `src/compliance/matrix.ts`
- [ ] `src/uptime/mapping.ts`
- [ ] `src/explain.ts`
- [ ] `src/resolve-cache.ts` (if capability uses cache keying by provider)
- [ ] `cli/const.ts` (+ `cli/help.ts` if house/BYOK prose)
- [ ] `openapi.yaml` + `openapi.es.yaml` — provider / credential / attribution enums; `*_credentials_required` on the **correct** capability 400 list only
- [ ] `.dev.vars.example` + `worker-configuration.d.ts` — optional dogfood `VENDOR_API_KEY`
- [ ] Docs: `docs/byok-zoominfo.md`, `docs/os-router-credentials.md`, `README.md` BYOK / house-key lines
- [ ] Tests that pin provider lists: `tests/fitness.test.ts`, `tests/opt-in-providers.test.ts`, `tests/credentials.test.ts`, `tests/app.test.ts`, `tests/compliance.test.ts`, `tests/routing.test.ts`, `tests/live-dev-vars.ts`, peers as needed

**Do not touch for opt-in BYOK**
- [ ] `src/routing/field-stacks.ts` (default stacks)
- [ ] `HOUSE_KEY_RESALE_OS_PROVIDERS` (unless counsel signed + Harris explicitly asks for house resale)

**App verify**
```bash
npm run check:types && npm run lint && npm test && npm run check:surfaces
```

### 3.2 `outboundsync/kingminos-website` (Apollo #34 / Prospeo #33)

- [ ] `src/lib/credentials.ts` — `CREDENTIAL_PROVIDERS` + `CREDENTIAL_VENDORS` (`house: false` for BYOK)
- [ ] `src/lib/credentials.test.ts` (+ `credentials-ui.test.ts` if counts/copy)
- [ ] Docs MDX: `src/content/docs/docs/api/credentials.mdx`, capability page (e.g. `company-resolve.mdx`), `docs/mcp`, `docs/skills`, `docs/cli`, maybe `docs/index.mdx`
- [ ] `scripts/check-agent-surfaces.mjs` if it pins keys-screen / provider presence

**House-key copy must read:** LeadMagic, Wiza, Findymail = house; ZoomInfo, AI Ark, BuiltWith, Prospeo, Apollo, **+ new BYOK** = BYOK.

**Website verify**
```bash
npm run check:session && npm run lint && npm run check:types && npm run build && npm run check:agent
```

**Deploy:** merge ≠ live until `kingminos-runtime` is deployed.

### 3.3 `outboundsync/kingminos-mcp` (Apollo #10 / Prospeo #8)

- [ ] `src/schemas.ts` — `PROVIDER_NAME_VALUES` + `CREDENTIAL_PROVIDER_VALUES` + describe strings + `apiKey` field description (**functional** — without this, `routing.only` and `put_credentials` reject the id)
- [ ] `inventory/openapi-surfaces.json` — pin `providers[]` and `credentialProviders[]` (or `npm run inventory:refresh` **after** API Worker redeploy)
- [ ] `src/server.ts` BYOK prose
- [ ] `README.md` BYOK sentence
- [ ] Format with pinned Biome: `npx --yes @biomejs/biome@1.9.4 check --write .`

**MCP verify**
```bash
npm run typecheck && npm run check:surfaces && npm run check:providers && npm test
```

**Deploy:** redeploy Worker `kingminos-mcp-prod`.

### 3.4 `outboundsync/kingminos-skills` (Apollo #6 / Prospeo #4)

- [ ] `scripts/validate/fixtures/providers.yaml` — entry (`supply: byok`, `credentials_required: {id}_credentials_required`, `path_enum: true`, `api_key: true` as appropriate)
- [ ] `scripts/validate/fixtures/openapi-inventory.yaml` — credential path-param enum if present
- [ ] `skills/credentials/SKILL.md` + `references/endpoints.md` + `references/examples.md`
- [ ] Capability skill(s) touched (e.g. `skills/company-resolve/SKILL.md` + `references/endpoints.md`)
- [ ] `README.md`, `CONVENTIONS.md`, `SECURITY.md`
- [ ] Bump `metadata.version` **from tip** on every edited skill + `CHANGELOG.md` entry (`version-bumped` CI rule)

**Skills verify**
```bash
npm run validate && node scripts/validate/cli.mjs --base origin/main && npm test
```

---

## 4. Copy-paste code patterns

### 4.1 Provider adapter shape (company.resolve domain hop)

Mirror `src/providers/apollo.ts` or `src/providers/prospeo.ts`:

- `name = "{id}" as const`
- `companySearch.searchByDomain` → vendor enrich
- `searchByName` → `unsupportedEmptyResult` (unless product explicitly wants name search)
- Map into `CompanyCandidate`; put speculative fields in `extra` only (never new product fields; hierarchy stays ZoomInfo)
- Never send expensive personal-data flags (Apollo: no `reveal_phone_number` / `reveal_personal_emails`; Prospeo: no mobile)

### 4.2 Descriptor

```ts
export const {ID}_DESCRIPTOR: ProviderDescriptor = {
  name: "{id}",
  displayName: "{Label}",
  auth: "api_key",
  resaleAllowed: false,
  operations: {
    company_search_by_domain: {
      capability: "company.resolve",
      providerCreditsEstimate: {ID}_CREDITS,
      priceMicroUsd: 0,
      inputs: ["domain"],
      billingMode: "on_success", // or "always" per vendor billing
    },
  },
  rateLimit: { /* from vendor docs */ },
};
```

### 4.3 Opt-in reachability (the AI Ark / Prospeo trap)

Registering in `PROVIDER_NAMES` is **not** enough. For `km_*` / session callers:

1. Add hop in `src/capabilities/registry.ts`
2. Add id to `presetProvidersFor("company.resolve")` in `src/routing/presets.ts`
3. Leave `field-stacks.ts` alone so defaults never call it

Without (2), `routing.only: ["{id}"]` returns **400 invalid_routing**.

### 4.4 Credentials

- Hint string in `CREDENTIALS_REQUIRED_HINT` / peer map
- Dogfood: `OS_API_KEY_HOUSE_ENV.{id} = env.{ID}_API_KEY`
- **Do not** add to `HOUSE_KEY_RESALE_OS_PROVIDERS`
- Store + verify before persist (`credential-verify.ts`)

### 4.5 OpenAPI

- Add `{id}` to every ProviderName / AttributionProvider / credentials path enum that lists peers
- Add `{id}_credentials_required` to the capability’s 400 list that can refuse for missing keys
- **Do not** paste that error onto unrelated capabilities (Prospeo lesson #157: resolve-only, not `company.domain`)

### 4.6 Auth header cheatsheet (existing)

| Scheme | Header | Used by |
| --- | --- | --- |
| `bearer` | `Authorization: Bearer …` | Findymail, Wiza, … |
| `x-token` | `X-TOKEN` | AI Ark |
| `x-api-key` | `x-api-key` | Apollo (added for Apollo) |
| inline | `X-KEY` | Prospeo |
| inline | `X-API-Key` | LeadMagic verify |
| inline | `Authorization: API …` | BuiltWith |

---

## 5. Token traps (burned cycles — avoid)

1. **`presetProvidersFor` missing** — provider exists but `routing.only` 400s (Prospeo + AI Ark).
2. **House-key copy drift** — satellites still saying “LeadMagic is the only house-key vendor” after #156. Always sync LeadMagic + Wiza + Findymail.
3. **OpenAPI / provider-enum CI drift** — mcp `check:providers` + skills `provider-enum` now fail closed. Update pins/`providers.yaml` in the same PR.
4. **Wrong 400 surface** — `*_credentials_required` on the wrong operation (#157).
5. **`verifyApiKeyGet` status mapping** — vendors that reject with 400/422 need `rejectedOn` or deliberate handling, else verify becomes `503 credential_verify_unavailable` (Prospeo `INVALID_API_KEY`).
6. **Dogfood env vs house resale** — setting `{ID}_API_KEY` for tenant `default` ≠ adding to `HOUSE_KEY_RESALE_OS_PROVIDERS`.
7. **mcp Biome pin** — format with `@biomejs/biome@1.9.4` or CI churns wrap diffs.
8. **Skills version bump from tip** — bump relative to current `main`, not stale local.
9. **Live lag** — CI live OpenAPI compare fails until `kingminos-api-prod` redeploy; pin may lead live (allowed for mcp inventory policy).
10. **Sibling rebase** — budget one rebase per satellite; website may need `npm install` if `package.json` moved.
11. **BuiltWith** — do not flip to house; ToS / reseller parked; BYOK + tenant isolation only.
12. **Merging #132** — do not. Brand/allowlist PR was closed; house expansions are explicit narrow PRs (#156 style).

---

## 6. Smoke tests / acceptance

After API redeploy:

```bash
# 1) OpenAPI enum live
curl -sS https://api.kingminos.com/openapi.json | jq '.. | objects | .enum? // empty' | rg '{provider_id}'

# 2) Credential validate (expect 400 credential_rejected on garbage key, not 503)
# PUT /v1/credentials/{provider} with session or km_ key — body { "apiKey": "bad" }

# 3) Opt-in routing (with a real BYOK key stored, or dogfood default + house env)
# POST /v1/company/resolve  { "domain": "example.com", "routing": { "only": ["{provider_id}"] } }
# Expect: attempts include provider; not invalid_routing; missing key → {id}_credentials_required

# 4) Default path still ignores vendor
# POST without routing.only — provider must not appear in default hops
```

Per-repo green checks from §3. Redeploy website (`kingminos-runtime`) and MCP (`kingminos-mcp-prod`). Confirm MCP Zod accepts `put_credentials({ provider: "{id}" })` and `routing.only: ["{id}"]`.

---

## 7. What NOT to do

- Do **not** merge House Keys [#132](https://github.com/outboundsync/kingminos-application/pull/132) wholesale.
- Do **not** add BYOK vendors to default routing / `field-stacks`.
- Do **not** mark BuiltWith (or unsigned vendors) as customer house keys.
- Do **not** treat dogfood `{ID}_API_KEY` as reseller House Keys.
- Do **not** expand employment hops without an explicit product decision (Apollo: firmographic only).
- Do **not** invent providers in skills/MCP without app enums first.
- Do **not** put secrets, KEKs, or live API keys in PRs, skills, or this doc tree.
- Do **not** say “SF” — say **SFDC**.
- Do **not** assume merge == production for website/MCP/API Workers.

---

## 8. Minimal DeepSeek prompt template

Copy, fill brackets, paste to the agent:

```
TASK: Add KingMinos BYOK provider [{provider_id}] / [{Label}] across four repos.
ORG: outboundsync. Repos: kingminos-application, kingminos-website, kingminos-skills, kingminos-mcp.
GOLDEN PATH: copy Apollo PR pattern (app #158, website #34, skills #6, mcp #10) and/or Prospeo.
PLAYBOOK: kingminos-mcp/docs/byok-provider-playbook.md (or docs/byok-provider-playbook.md in this repo) — follow mechanically. Prefer gh pr diff / gh api contents over full clones.

INPUTS:
- provider_id: [{provider_id}]
- auth: [{header or scheme}]
- docs_url / base_url: [{url}]
- endpoints: [{method path + params}]
- capability: [{company.resolve | …}] — scope cuts: [{e.g. no employment}]
- credential body: [{apiKey} | {clientId,clientSecret}]
- verify: [{method path + reject signals}]
- credits: [{n}] billingMode: [{on_success|always}]
- compliance: [{soc2, data}]
- dogfood env name: [{ID}_API_KEY] (default tenant only; NOT house resale)

RULES:
1) API repo first, then website, mcp, skills.
2) resaleAllowed: false; do NOT add to HOUSE_KEY_RESALE_OS_PROVIDERS.
3) Off every default path; MUST add to presetProvidersFor(capability).
4) OpenAPI: enums + {id}_credentials_required on the correct capability 400 list only.
5) House-key copy stays: LeadMagic, Wiza, Findymail house; new vendor BYOK.
6) Say SFDC never SF. No secrets in git.
7) Do not merge PR #132. Do not default-route. BuiltWith stays BYOK-only.
8) After app merge note: redeploy kingminos-api-prod gates live OpenAPI; website needs kingminos-runtime; MCP needs kingminos-mcp-prod.
9) Run the verify commands in the playbook; paste results in the PR body.
10) One PR per repo, branch [{provider_id}-byok], squash merge when green.

OUTPUT: four PRs + file lists + verify command output. Stop if a policy input is missing — do not invent House Keys or extra capabilities.
```

---

## 9. Related docs

- **This repo:** `docs/byok-provider-playbook.md`, `.cursor/skills/byok-provider-rollout/SKILL.md`
- **Application:** Apollo four-repo plan — `kingminos-application/docs/future/apollo-byok-four-repos.md`; BYOK reference docs under `kingminos-application/docs/`
- **Website:** Your Keys catalog and public docs — `kingminos-website` (`src/lib/credentials.ts`, MDX under `src/content/docs/`)
- **Skills:** provider fixtures and capability skills — `kingminos-skills` (`scripts/validate/fixtures/providers.yaml`, `skills/*/SKILL.md`)
- Org-level ops notes (house-keys agreements, deploy lag) may live outside these repos; keep satellite copy in sync when policy changes.
