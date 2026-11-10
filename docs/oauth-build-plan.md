# KingMinos MCP OAuth build plan

Planning only. No production code in this PR. Do not merge OAuth implementation to `main` until Harris has bound infra and the authorization server is verified: every push to `kingminos-mcp` `main` deploys Worker `kingminos-mcp-prod`.

**Goal:** add OAuth 2.1 next to existing API-key auth so KingMinos can be listed in ChatGPT/OpenAI apps, the Claude connectors directory, Meta Muse, Cursor Marketplace, the MCP Registry, Smithery, Glama, and mcp.so.

**Canonical design:** `outboundsync/kingminos-application` `docs/mcp-oauth-design.md`, merged 2026-10-22 as PRs [#323](https://github.com/outboundsync/kingminos-application/pull/323) (Fizzy #103 step 1) and [#325](https://github.com/outboundsync/kingminos-application/pull/325) (Harris decisions). Implementers **must re-read that file** before writing code.

**How this plan was assembled (2026-11-10):** this Cloud Agent token cannot clone `kingminos-application` (private; GitHub 404). Spec choices below are recovered from (1) the #323 review comment on commit `45a58fb`, (2) #325 commit titles, (3) the 2026-11-11 directory-prep memo which quotes design §§9.4, 11, 12, (4) live prod HTTP, (5) `kingminos-mcp` `main` @ `313b7e3`, (6) live `GET https://api.kingminos.com/openapi.json`, (7) MCP Authorization spec 2025-11-25. If the canonical doc disagrees, the canonical doc wins.

---

## 0. Hard constraints (do not reopen)

- **Add** OAuth next to API-key auth. Never replace keys. Salesforce Named Credentials and developers keep `Authorization: Bearer km_…` / `osr_…`.
- OpenAPI changes are **additive only**. Do not remove response fields or `next_steps` action names.
- Public text never reveals the recipe (lookup order, which vendor does which step).
- Call KingMinos a **router** or **data enrichment router**. No legal-status claims.
- Merging `kingminos-mcp` `main` auto-deploys prod. OAuth RS discovery must not land until the AS metadata URL returns 200. Do not publish fake `authorization_servers`.
- Directory copy: no pricing, credits-for-sale, free-daily, trials, or upgrade wording inside ChatGPT. Signing in to an existing paid account is allowed.

---

## 1. Current state, with evidence

Probed 2026-11-10 from this environment. Matches the 2026-11-11 directory-prep memo.

### 1.1 Hosted MCP (resource server)

| Check | Result | Evidence |
| --- | --- | --- |
| Endpoint | Live Streamable HTTP | `https://mcp.kingminos.com/mcp`. Worker `kingminos-mcp-prod`, custom domain only (`wrangler.jsonc`). |
| Runtime | `2026.10.03.0` @ `313b7e3` | `GET /health` → `{"ok":true,"service":"kingminos-mcp","version":"2026.10.03.0","git_sha":"313b7e3330ffb52a37b8700560e698ef9b36826f"}`. `src/config.ts` `VERSION` matches `package.json`. |
| Auth | Bearer API key only | `src/fetch.ts` `readTenantBearer`. Worker never reads `KINGMINOS_API_KEY`. Forwards `Authorization: Bearer` + `X-KingMinos-Client: mcp` to `https://api.kingminos.com`. |
| Unauthenticated `POST /mcp` | **401, no `WWW-Authenticate`** | Body `{"error":"Missing Authorization header","hint":"Send Authorization: Bearer <token>."}`. Response headers: `content-type` only. |
| RFC 9728 PRM | **404** | `GET /.well-known/oauth-protected-resource` and `…/oauth-protected-resource/mcp` both `{"error":"Not found"}`. |
| OpenAI domain challenge | **404** | `GET /.well-known/openai-apps-challenge`. |
| Server card | Thin and stale | `GET /.well-known/mcp/server-card.json` → `version 2026.10.03.0`, empty `capabilities.tools`, **no `authentication`**, `privacy_url` / `terms_url` without trailing slash (each 301s). |
| OAuth code on `main` | **None** | Grep of `src/` for `oauth-protected-resource`, `WWW-Authenticate`, `authorization_servers`, PKCE, DCR, CIMD: empty. Vendor ZoomInfo/Snov.io OAuth in `schemas.ts` is BYOK, not MCP login. |
| Bindings | No KV, D1, R2, service bindings | `wrangler.jsonc` vars only. `src/fetch.test.ts` asserts no D1/R2 and no OutboundSync router bindings. A later OAuth PR **will** add a service binding to the API Worker; that test must be updated to allow `AUTH_SERVER` / `validateToken` and still forbid router D1/R2. |
| Tool split | Prefix only | `kmadm_…` → 5 admin tools (`src/admin-tools.ts`). Any other bearer → all 40 tenant tools. **No per-client / per-directory filter.** |

### 1.2 KingMinos API (future authorization server)

| Check | Result | Evidence |
| --- | --- | --- |
| Health | Live | `GET https://api.kingminos.com/health` → `kingminos-api-prod`, version `2026.10.05`, `git_sha` `8bcb4943…`, `billing_mode: live`. |
| AS metadata | **Not served** | `GET https://api.kingminos.com/.well-known/oauth-authorization-server` → **401** `detail: missing` (global bearer gate; the path is not exempt). |
| OpenAPI auth | Bearer HTTP only | `components.securitySchemes.bearer`. No `oauth2` scheme. Auth-ish paths are session `/v1/auth/*` (login, verify, me, logout) — cookie/app, not MCP tools. |
| Key families | Unchanged | `km_` user PATs (scoped, include `billing:read` on new tokens); `osr_` tenant keys (401 on billing reads); `kmadm_…` admin. `erase` required for `DELETE /v1/subjects/{subject_key}`. `capability:*` does **not** imply `billing:read`. |
| MCP inventory | 40 resource ops | `src/catalog.ts` `LIVE_RESOURCE_ROUTES`. `/v1/auth/*` and `/v1/account/*` are excluded from tools. |

### 1.3 Tools today (blockers for every directory)

`server.registerTool` in `src/server.ts` (~887) passes `description`, `inputSchema`, `annotations` — **no `title`**. Read tools set `readOnlyHint` / `openWorldHint` / `idempotentHint` and **omit `destructiveHint`**. Descriptions start `GET /v1/…` or `POST /v1/…`.

Steering / promotion still in public text:

- `get_recipes`: “KingMinos is a trusted extension, not a competitor”.
- Server `instructions`: “Call get_capabilities before the first resolve…” and the `submit_feedback` nudge “wanted a field or provider we don't have”.
- `instructions` and `put_credentials` list 19 BYOK vendors. README names house-key and BYOK vendors. `kingminos-skills` README names LeadMagic, Wiza, Findymail, AIArk (house) plus the BYOK list.

Admin tools (`abuse_report`, `partner_report`, `partner_payout`, `feedback_report`, `partner_admin`) never appear for tenant bearers. They must stay hidden from every directory.

### 1.4 Directories and listings (2026-11-11 prep + re-probe)

| Surface | State | Blocks OAuth-directory submit? |
| --- | --- | --- |
| Official MCP Registry `com.kingminos/mcp` | Active, latest **`2026.10.23`**. No `icons`, no `remotes[].headers` Authorization. Description still “Multiple data providers, pay only for results.” `server.json` is not in this repo. | No (API key). Should republish after metadata pass. |
| Smithery | Needs server-card `tools` + `authentication` or OAuth/CIMD. | No (API-key config field). Card gap **blocks a useful listing**. |
| PulseMCP | Ingests the official registry. Submissions paused. | No. |
| Glama | Claim via `glama.json` **unverified**. | No. |
| mcp.so | Paid $39 or GitHub-issue route. Harris decision. | No. |
| Cursor Marketplace (+ Grok Bot) | No `.cursor-plugin/` package. Docs allow OAuth **or** `Authorization: Bearer ${VAR}`. Individual (non-team) variable UX unverified. | API-key listing possible after package. OAuth later for one-click individuals. |
| ChatGPT / OpenAI | Portal has **no API-key flow**. OAuth required. Bans selling credits, collecting API keys, unofficial pass-through connectors. | **Yes — OAuth + subset + reviewer password login.** |
| Claude Connectors | OAuth 2.0 + PKCE S256, DCR or CIMD. Paid Claude plan on the submitting account. Data-handling questionnaire. Callback `https://claude.ai/api/mcp/auth_callback`. | **Yes.** |
| Meta Muse | Business verification + OAuth or API key; Read Only option requested. Harris: in scope? | Practically **yes** (per-user billing). |
| xAI grok.com catalog | No public submit path. Custom connector already works with a key. | Partner outreach, Harris. |
| skills.sh | No submit step. `npx skills add outboundsync/kingminos-skills` creates the listing. | No. |
| Support URL | `kingminos.com/support/` and `/contact/` **404**. Only `mailto:support@outboundsync.com`. | **Blocks OpenAI** (support URL required). |
| Legal | `/privacy/`, `/terms/`, `/dpa/`, `/acceptable-use/` 200, v1.0. | OK, pending Edgar data-handling answers. |

### 1.5 Design status

PRs **#323** and **#325** merged 2026-10-22. Implementation phases 2–11 are **not started**. Fizzy #103 remains the tracker.

Recovered from the #323 review comment on `45a58fb`:

- Canonical resource `https://mcp.kingminos.com/mcp` + path-insert PRM.
- Library `@cloudflare/workers-oauth-provider` **≥ 1.2.4**.
- Token store: **`OAUTH_KV` only** (no D1 OAuth tables).
- MCP pre-validation via Service Binding **`validateToken`**.
- Default grant `capability:*`; **never** `webhooks` or `erase`.
- Consent on **`api.kingminos.com`**, login bounce to the app.
- `iss` required.
- `oauth` **keyPrefix** predicate (API must accept OAuth tokens as a first-class prefix, next to `km_` / `osr_` / `kmadm_`).
- CIMD **and** DCR, plus ChatGPT per-tool metadata.
- §12 listed **3 open decisions for Harris** at design time; #325 then recorded member levels and the §9.4 directory matrix.

Recovered from #325 commits:

- `130b896` — v1 OAuth member permission levels.
- `63b358f` — directory review requirements (§9.4).
- `e5d86a2` — per-platform directory review matrix (Harris 2026-10-22).

Prep memo maps §11 implementation order as: AS+KV (3) → auth integration (4) → MCP discovery+401 (2) → binding+validate (5) → platform identity (6) → consent+members (7) → reviewer password (8) → `securitySchemes` / `_meta["mcp/www_authenticate"]` (rest of 9) → E2E (11). Infra is §12 (Harris). Phase 9-minus-OAuth is the tool-metadata pass in this repo.

---

## 2. PR-by-PR plan (merge order)

**Rule:** land nothing on `main` that advertises an authorization server until that server’s RFC 8414 document returns 200 without auth. Tool-cleanup PRs (Wave A) are independent and are the only items that can merge before the AS is live.

Sizes: XS / S / M / L. Tests are the minimum; add more if the slice grows.

### Wave A — directory hygiene (no OAuth). Can merge independently.

These are design phase 9 minus `securitySchemes`, plus the 2026-11-11 ship list. They unblock Smithery / Glama / Cursor / registry copy and stop Claude/OpenAI scan findings on titles and steering.

| ID | Repo | Scope | Size | Tests | Prod verify (after Harris merges) |
| --- | --- | --- | --- | --- | --- |
| **A1** | `kingminos-mcp` | Bump `VERSION` + `package.json` to a new CalVer (registry is already `2026.10.23`; code is `2026.10.03.0`). Trailing slashes on `PRIVACY_URL` / `TERMS_URL`. | XS | Existing `src/fetch.test.ts` version + card URL assertions. | `GET /health` version; `GET /.well-known/mcp/server-card.json` privacy/terms **200** (no 301). |
| **A2** | `kingminos-mcp` | Richer server card: `authentication: {required: true, schemes: ["bearer"]}` (add `"oauth2"` only in Wave C), `tools[]` from `TOOL_SPECS` (name, title, description, inputSchema, annotations), `websiteUrl`, `documentationUrl`, `supportUrl`, `iconUrl`. | S | `src/fetch.test.ts`: card lists all 40 tenant tools, no admin tools, no secrets. | Unauth `GET` card JSON includes `tools` and `authentication`. Smithery scan can list tools. |
| **A3** | `kingminos-mcp` | Commit `server.json` (schema `2025-12-11`) and `glama.json`. Icons (SVG + 192 PNG). `remotes[0].headers` Authorization Bearer (isRequired, isSecret). Router wording in description. Version = A1. Maintainer GitHub user = Harris pick. | XS–S | Snapshot test that `server.json` version matches `VERSION`. | Harris republishes with DNS key (not this PR). Confirm registry latest version, icons, headers. |
| **A4** | `kingminos-mcp` | Tool metadata pass (all 40 + 5 admin): `title` on every tool; explicit `destructiveHint: false` on reads; `openWorldHint: false` on workspace-bounded tools (balance\*, usage, runs, webhooks, credentials, events, feedback); rewrite descriptions (drop `GET /v1` prefixes, keep limits and side effects); remove steering (“trusted extension”, “Call get_capabilities before…”, feedback provider-nudge). Vendor lists: follow Harris decision D1. Do **not** change tool names, input schemas, or response forwarding. | M | `npm run ci` (`check:surfaces` still 40 ops). New assertions: every `TOOL_SPECS` + admin tool has `title` and all three of `readOnlyHint`/`destructiveHint`/`openWorldHint`. | Inspector / `tools/list` with a `km_` key shows titles; no steering strings in descriptions or `instructions`. |
| **A5** | `kingminos-website` | `https://kingminos.com/support/` page (email, docs, status, security contact). Footer + `llms.txt`. **Harris merges.** | S | Website tests / link check. | `GET /support/` 200. Use as OpenAI `supportURL` and Claude support contact. |
| **A6** | `kingminos-mcp` or new public repo (D3) | Cursor plugin: `.cursor-plugin/plugin.json` (name `kingminos`, no “MCP” suffix), `mcp.json` with `url` + `Authorization: Bearer ${KINGMINOS_API_KEY}`, `variables`, logo from `kingminos-favicon.svg`, README. | S–M | Local Cursor install with the capped test key (never print the key). | Listing submit is Harris. Document that individuals may need OAuth (Wave C) if plugin variables are team-admin-only. |
| **A7** | `kingminos-skills` | If D1 = remove vendors: strip house-key and BYOK names from README / credentials skill. Keep API-key auth skill; add a one-liner that hosted MCP will also support OAuth (link, no recipe). | S | Pack validator. | `npx skills add` still installs. |

**Do not** put `authorization_servers` or `schemes: ["oauth2"]` on the card in Wave A.

### Wave B — authorization server on `kingminos-application`. Merge to `main` only with a kill switch.

If `OAUTH_KV` is missing or `OAUTH_ENABLED` is off, well-known AS routes must keep today’s behavior (401/404) so we never advertise a dead AS. Exempt `/.well-known/oauth-authorization-server` (and `/.well-known/openid-configuration` if served) from the global bearer gate **only when the AS is actually enabled**.

| ID | Repo | Maps to design §11 | Scope | Size | Tests | Prod verify |
| --- | --- | --- | --- | --- | --- | --- |
| **B1** | `kingminos-application` | Phase 3 | Add `@cloudflare/workers-oauth-provider` ≥ 1.2.4. Construct `OAuthAuthorizationServer` with `issuer` = `https://api.kingminos.com`, `resources` = `[https://mcp.kingminos.com/mcp]`. Bind `OAUTH_KV` (Harris, §5). `compatibility_flags` include `global_fetch_strictly_public` (required for CIMD). Serve RFC 8414 metadata, token, revocation, registration **behind the enable flag**. No D1 OAuth tables. | L | Provider unit tests: metadata JSON shape (`issuer`, `authorization_endpoint`, `token_endpoint`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported` includes `authorization_code` + `refresh_token`, `revocation_endpoint`, `client_id_metadata_document_supported: true`, `registration_endpoint`). Disabled-flag: metadata path still 401. | After Harris binds KV and sets the flag: unauth `GET https://api.kingminos.com/.well-known/oauth-authorization-server` **200**. `iss` in metadata equals issuer. |
| **B2** | `kingminos-application` | Phase 4 | Auth integration. `/authorize` is app-owned: `parseAuthRequest()`, bounce unauthenticated users to `https://app.kingminos.com/login/` with return URL, `completeAuthorization()` with workspace/user/scope **props**. Add `oauth` to the API **keyPrefix** predicate so OAuth access tokens are distinct from `km_` / `osr_` / `kmadm_` and still pass existing prefix checks. Resource indicator RFC 8707 `resource=https://mcp.kingminos.com/mcp` required on authorize + token. PKCE S256 required; reject missing/plain. | L | Login-bounce 302; PKCE negative cases; `resource` mismatch rejected; prefix tests: `km_` unchanged, OAuth token does not parse as `km_`. | Browser: start authorize without session → app login → return. Token endpoint rejects no-PKCE. Existing `km_` API calls still 200. |
| **B3** | `kingminos-application` | Phase 5 | Export `WorkerEntrypoint.validateToken(resource, token)` for the MCP service binding. Audience must exactly match the canonical MCP URL. Return `null` on mismatch/expiry (MCP then 401). | M | Binding contract tests; wrong-audience token → null; expired → null. | From a one-off Worker or wrangler tail: validate a freshly minted token for `https://mcp.kingminos.com/mcp` succeeds; a `km_` key returns null. |
| **B4** | `kingminos-application` | Phase 6 | Platform identity + redirect allowlist. Support **CIMD** (SHOULD, MCP 2025-11-25) and **DCR** (MAY, needed for older clients / some directory portals). DCR `redirect_uris` must be exact-match against an allowlist that starts with: `https://claude.ai/api/mcp/auth_callback`, ChatGPT/OpenAI plugin callback(s) from the portal, Cursor, MCP Inspector loopback (`http://127.0.0.1:*`, `http://localhost:*`), Muse when in scope. Pre-register static client IDs for ChatGPT if the portal uses `provided`. Fetch CIMD over HTTPS, require `client_id` URL match, cache per HTTP cache headers. | M | Allowlist accept/reject table; CIMD fetch+match; DCR open-redirect attempt denied. | Inspector DCR against **staging/flagged** AS. Do not open DCR to the world until allowlist is proven. |
| **B5** | `kingminos-application` (+ `kingminos-website` if the HTML is served from the app host) | Phase 7 | Consent screen on `api.kingminos.com`: client name, workspace picker, requested scopes in plain language, member-level gating from #325. Default scopes `capability:*` (and `billing:read` so `get_balance` works). Never offer `webhooks` or `erase` on the v1 consent screen. Copy: “KingMinos is a data enrichment router.” No vendor sequence. | M | Owner vs member fixtures (copy the #325 table). Consent denial. Workspace bind in token props. | Real user: consent shows workspace name; member cannot grant owner-only scopes; grant appears in an account “connected apps” list (add if missing — additive API). |
| **B6** | `kingminos-application` | Phase 8 | Reviewer-only password login (Harris already approved). Dedicated account, password, **no MFA, no email/SMS, no magic links**, works immediately. Not offered on the public login page (feature flag / allowlisted emails). Compd credits, sample runs, no real customer data. Edgar gates the account (design §9.4.5). | S–M | Flag off → password path 404. Flag on → password works only for the reviewer user. | Harris + Edgar: credentials stored only in the OpenAI/Claude **portal**, never in git. |
| **B7** | `kingminos-application` | Phase 9 (OpenAPI slice) | Additive OpenAPI: add `oauth2` security scheme (authorizationCode + PKCE) **alongside** `bearer`. Do not remove the bearer scheme or any fields. Optional documented OAuth paths if they belong in the public spec; well-known can stay undocumented. | S | Spec lint; `kingminos-mcp` `check:surfaces` still green (no new resource ops unless we intend new tools — we do not). | `GET /openapi.json` contains both schemes. MCP inventory unchanged. |

### Wave C — MCP resource server. Merge **after** B1 metadata is 200 on prod.

| ID | Repo | Maps to | Scope | Size | Tests | Prod verify |
| --- | --- | --- | --- | --- | --- | --- |
| **C1** | `kingminos-mcp` | Phase 2 + 5 | RFC 9728 PRM at `/.well-known/oauth-protected-resource` **and** `/.well-known/oauth-protected-resource/mcp`. `resource` = `https://mcp.kingminos.com/mcp`. `authorization_servers` = `["https://api.kingminos.com"]`. `scopes_supported` = default grant. Unauth `POST /mcp` still **401** (not 403) and **adds** `WWW-Authenticate: Bearer realm="mcp", resource_metadata="https://mcp.kingminos.com/.well-known/oauth-protected-resource/mcp", scope="…"`. Keep JSON body for API-key clients. Wrap MCP with `OAuthResourceServer`; `validateToken: (env) => env.AUTH_SERVER.validateToken`. **API keys still work:** if `validateToken` returns null, fall back to today’s `readTenantBearer` and forward the key upstream. Never send an OAuth access token to a different audience. | L | 401 has `WWW-Authenticate`; PRM JSON; OAuth token happy path (mock binding); `km_` still lists 40 tools; malformed bearer still 401. Update wrangler test: allow **one** service binding to the API Worker; still forbid router D1/R2. | Unauth PRM 200. Unauth POST `/mcp` 401 **with** `WWW-Authenticate`. Inspector OAuth connect. Existing Cursor `mcp.json` with `km_` still works. |
| **C2** | `kingminos-mcp` | Directory subset | Per-client tool filtering (new). Inputs: validated token props (`client_id` / platform) or a static map of directory client IDs. ChatGPT + Claude: see §4 hide list. Cursor OAuth / API-key / Inspector: full tenant tool set minus admin. Admin prefix unchanged. Default (unknown DCR client): **directory subset**, not the full set (fail closed for `put_credentials`). | M | Table-driven `tools/list` per client class. | ChatGPT-shaped client cannot `tools/list` `put_credentials`. `km_` still sees all 40. |
| **C3** | `kingminos-mcp` | Phase 9 rest | `securitySchemes` on the server (bearer + oauth2). Initialize / error `_meta["mcp/www_authenticate"]` mirroring the header. Card `authentication.schemes` includes `oauth2`. | S | Card + initialize snapshot. | Card shows both schemes. |
| **C4** | `kingminos-mcp` | Portal | `GET /.well-known/openai-apps-challenge` returns the portal token as `text/plain`. Token is a Wrangler secret, not committed. 404 until the secret is set. | XS | Secret missing → 404; set → exact body, no JSON wrapper. | After Harris pastes the portal token: URL 200, challenge passes. |

### Wave D — docs, packaging, E2E. After C1 on prod.

| ID | Repo | Scope | Size | Tests | Prod verify |
| --- | --- | --- | --- | --- | --- |
| **D1** | `kingminos-website` | `/docs/mcp/` OAuth connect (Claude, ChatGPT, Cursor, Inspector). Keep the Bearer section for Salesforce/dev. Router wording. No recipe. No credit upsell. Support URL. | S | Link check. | Docs 200; both auth paths documented. |
| **D2** | `kingminos-website` | 512×512 square PNG + dark icon from the favicon SVG. OpenAI plugin ZIP skeleton (`plugin.json` `extensions.com.openai`, `mcp.json` URL-only, no headers). Name “KingMinos”, subtitle ≤30 e.g. “B2B data enrichment router”. | S | ZIP contents fixture. | Portal upload (Harris). |
| **D3** | `kingminos-mcp` + application | Design phase 11 E2E: MCP Inspector OAuth; Claude custom connector callback; ChatGPT plugin OAuth; Cursor OAuth or plugin variable. Refresh + revoke. API-key regression. | L | Automated Inspector against a preview Worker if possible; otherwise a checked-in runbook Harris executes once. | All four clients complete authorize → `tools/list` → one cheap read (`get_capabilities`) → one billed lookup on the reviewer workspace. |

### Suggested git merge order (when Harris is ready)

```text
A1 → A2 → A4 → A3 → A5 → A6 → A7
then  B1 (flag off) → Harris binds OAUTH_KV + secrets
then  B2 → B3 → B4 → B5 → B6 → B7
then  Harris sets OAUTH_ENABLED on api; verify AS metadata 200
then  C1 → C2 → C3 → C4
then  D1 → D2 → D3
```

A-wave can ship (and even submit no-OAuth directories) while B-wave is in progress. **Do not submit ChatGPT, Claude, or Muse until D3 is green.**

---

## 3. Spec choices

Implementers: copy these from `docs/mcp-oauth-design.md` if any value differs.

### 3.1 Discovery metadata

| Piece | Choice |
| --- | --- |
| Canonical MCP resource | `https://mcp.kingminos.com/mcp` (no trailing slash). RFC 8707 `resource` parameter required. |
| PRM (RFC 9728) | Serve **both** `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` on `mcp.kingminos.com`. |
| 401 | Always 401 (not 403) when unauthenticated. Add `WWW-Authenticate` with `resource_metadata` pointing at the path-insert PRM URL, plus `scope` (MCP SHOULD). Keep the existing JSON error body so API-key clients still see a hint. |
| AS issuer | `https://api.kingminos.com` (`iss` required). Metadata at `https://api.kingminos.com/.well-known/oauth-authorization-server`. Exempt from the global API bearer gate **only when the AS is enabled**. |
| AS vs RS split | API Worker = AS. MCP Worker = RS. Token validation over Cloudflare **service binding**, not a public introspect URL. |
| OpenID | Not required. MCP clients already try OIDC discovery as fallback; returning 401/404 there is fine. |

### 3.2 DCR and CIMD

Both, as in the #323 revision.

- **CIMD** advertised (`client_id_metadata_document_supported: true`). Preferred for MCP 2025-11-25 clients. Requires `global_fetch_strictly_public`. Validate HTTPS `client_id` URL, JSON `client_id` match, `redirect_uris` contain the request URI.
- **DCR** (RFC 7591) for older clients and portals that still POST `/register`. Registration is **not** open-ended: persist clients in `OAUTH_KV`, but `redirect_uris` must match the platform allowlist (B4).
- **Pre-registered / `provided`** clients for ChatGPT if the OpenAI portal issues a static client id.

Client selection order (MCP spec): pre-registered → CIMD → DCR → manual.

### 3.3 PKCE

OAuth 2.1 + Claude: **S256 required**. Reject `plain` and missing `code_challenge`. Public clients: `token_endpoint_auth_method: none`. Confidential directory clients (if any) use the method they register.

### 3.4 Token storage

`OAUTH_KV` only. No D1 OAuth tables (#323). Grants, auth codes, access tokens, refresh tokens, DCR client records live in KV via `workers-oauth-provider`. Props (workspace id, user id, member level, scopes, client id) encrypted as the library already does. MCP Worker stores **no** tokens.

Access-token lifetime: short (library default, ~1h unless the design says otherwise). Refresh tokens: rotate on use if the library supports it.

### 3.5 Scopes mapped to tools

v1 default grant (consent screen): **`capability:*`** + **`billing:read`**. Never **`webhooks`**, never **`erase`**.

| Scope | Tools it unlocks | Notes |
| --- | --- | --- |
| `capability:*` | All `company_*`, `person_*`, `email_verify`, `get_run`, `get_providers`, `get_capabilities`, `get_recipes`, `submit_feedback` | Same capability POSTs as a `km_` key. Spends workspace credits on hits only. |
| `billing:read` | `get_balance`, `get_balance_health`, `get_usage` | Needed because `capability:*` does not imply billing. Directory subset still hides ledger/forecast/history even if the token has this scope. |
| `webhooks` | `list_webhooks`, `create_webhook`, `get_webhook`, `patch_webhook`, `delete_webhook`, `rotate_webhook_secret`, `test_webhook`, `list_webhook_deliveries`, `replay_webhook_delivery`, `list_events` | **Not** in v1 OAuth consent. API-key clients keep these tools. |
| `erase` | `delete_subject` | **Not** in v1 OAuth. |
| credentials write | `put_credentials`, `delete_credentials` | **Not** in v1 OAuth (OpenAI restricted data = API keys). `list_credentials` is read-only status; still hide from ChatGPT/Claude (§4). |

Step-up: out of v1. A user who needs webhooks or BYOK uses the API key / app UI.

Admin tools: never OAuth-grantable.

### 3.6 Consent screen

Host: **`api.kingminos.com`** (AS `/authorize`). Unauthenticated → 302 to **`app.kingminos.com/login/`** with signed return URL, then back to consent.

Show: client name (from CIMD/`client_name` or allowlist), workspace name + picker if the user has several, scopes in plain language (“Run enrichments in this workspace and read its credit balance”), link to privacy + terms, Approve / Deny.

Do not show vendor names, lookup order, credit packs, or checkout.

Member levels: **copy the table from #325 / design §7**. Until re-read, treat as: only a workspace member can grant; owners/admins may grant for the workspace; members grant only as themselves; nobody can bind a workspace they do not belong to; v1 cannot grant `erase` or `webhooks` regardless of role.

### 3.7 Refresh and revocation

- Refresh: `grant_types_supported` includes `refresh_token`. MCP clients refresh without a new consent as long as the grant is valid.
- Revoke: RFC 7009 `revocation_endpoint` from the library. Also: user can revoke a grant from the app (additive `/v1/account/…` route is OK; do not remove existing token CRUD).
- MCP must 401 on revoked/expired tokens **with** `WWW-Authenticate` so clients restart discovery.

### 3.8 Workspace binding

`completeAuthorization` props **must** include `workspace_id` and `user_id`. Every subsequent API call authorized by that access token runs as that user in that workspace — same credit buckets, same Your Keys, same rate limits as a `km_` key in that workspace. Switching workspaces requires a new consent. Do not accept `X-Workspace-Id` from the MCP client as an override.

### 3.9 Credits and billing for OAuth users

OAuth does **not** create a parallel wallet. Hits bill the bound workspace exactly as today (outcome billing; miss = 0). Daily free credits and PAYG already on that workspace apply.

ChatGPT / Claude directory rules:

- Users may **sign in to an existing paid account**.
- Tools must **not** sell credits, start checkout, or promote upgrades.
- `get_balance` / `get_balance_health` may explain that a lookup needs credits and point at an **informational** pricing URL (`https://kingminos.com/pricing/`), never a checkout session.
- Hide ledger / forecast / history from those clients so the model is not steered into billing support.
- Insufficient credits → existing API error envelope; no new upsell fields.

Reviewer workspace: comped credits, sample successful and failed runs, no production customer subjects (Edgar).

---

## 4. Per-directory tool exposure

Admin tools (`kmadm_`) are never listed in any directory. Filtering is on `tools/list` / `registerTool`, not just docs.

Legend: **full** = all 40 tenant tools. **dir** = directory subset. **hide** = must not appear.

### 4.1 Directory subset (ChatGPT + Claude) — recommended

**Show:**

- Catalog: `get_providers`, `get_capabilities`, `get_recipes`
- Lookups: every `company_*`, `person_*`, `email_verify`
- Run read: `get_run`
- Account (non-upsell): `get_balance`, `get_balance_health`
- Feedback: `submit_feedback`

**Hide (required for OpenAI; recommended for Claude):**

| Tool | Why |
| --- | --- |
| `put_credentials` | OpenAI restricted data (API keys). Pass-through connector risk. |
| `delete_credentials` | Same. |
| `list_credentials` | Advertises BYOK vendors; unnecessary in ChatGPT. |
| `create_webhook`, `patch_webhook`, `delete_webhook`, `rotate_webhook_secret`, `test_webhook`, `replay_webhook_delivery` | Mutations; not in v1 OAuth scopes; secrets-once. |
| `list_webhooks`, `get_webhook`, `list_webhook_deliveries`, `list_events` | Webhook surface; hide with the mutations so Claude “run every tool” does not require webhook setup. |
| `delete_subject` | `erase`; destructive; not in v1 OAuth. |
| `get_balance_ledger`, `get_balance_forecast`, `get_balance_history` | Billing support / owner-only history; looks like selling or reconciling credits. |
| `get_usage` | Optional hide. Recommendation: **hide** in ChatGPT (usage totals invite upgrade talk); **show** in Claude if reviewers need it. Default: hide in both to keep one subset. |

This matches the prep proposal (lookups, `get_run`, `get_capabilities`, `get_balance`, `submit_feedback`) plus catalog reads and `get_balance_health` so the model can see paths and affordability without a ledger.

### 4.2 Other directories

| Directory | Exposure | Auth |
| --- | --- | --- |
| Cursor Marketplace / Grok Bot | **Full** 40 for API-key and Cursor OAuth (power users, Salesforce-adjacent). Plugin README still warns before credentials/erase/webhooks. | Bearer variable now; OAuth when Wave C lands. |
| Smithery / Glama / mcp.so / official registry | Card and `server.json` may list **all 40** (discovery). Runtime still requires auth. After OAuth, unknown clients get the **directory subset** (fail closed on `put_credentials`). | API key until C1; then either. |
| Meta Muse | If in scope: **directory subset** + explicit Read Only scope (`capability:*` GET-equivalent is not enough — lookups are POST). Offer a read-only grant that still allows catalog + `get_balance*` + `get_run` and **excludes** billed POSTs if Muse requires Read Only. That Read Only mapping is **open decision D8**. | OAuth. |
| Inspector / local | Full 40 for `km_` keys. OAuth grants follow consent scopes. | Either. |

### 4.3 Recommended titles (A4)

Pass `title` into `registerTool`. Keep `name` stable (OpenAPI `operationId`).

| name | title | readOnly | destructive | openWorld |
| --- | --- | --- | --- | --- |
| `get_providers` | List providers | true | false | false |
| `get_capabilities` | Get capability catalog | true | false | false |
| `get_recipes` | Get chaining recipes | true | false | false |
| `get_balance` | Get credit balance | true | false | false |
| `get_balance_ledger` | Get credit ledger | true | false | false |
| `get_balance_history` | Get credit history | true | false | false |
| `get_balance_forecast` | Forecast credit runout | true | false | false |
| `get_balance_health` | Check billing health | true | false | false |
| `get_usage` | Get usage totals | true | false | false |
| `company_resolve` | Resolve a company | false | false | true |
| `company_domain` | Decide company domain | false | false | true |
| `company_hierarchy` | Decide company hierarchy | false | false | true |
| `company_b2b_social` | Find company LinkedIn page | false | false | true |
| `company_x_account` | Find company X account | false | false | true |
| `company_icon` | Fetch company icon | false | false | true |
| `company_description` | Write company description | false | false | true |
| `person_verify_employment` | Verify employment | false | false | true |
| `person_language` | Detect a person's language | false | false | true |
| `person_phone` | Find a person's phone | false | false | true |
| `person_title` | Find a person's title | false | false | true |
| `person_b2b_social` | Find a person's LinkedIn | false | false | true |
| `person_name` | Normalize a person's name | false | false | true |
| `person_email` | Find a person's work email | false | false | true |
| `email_verify` | Verify email deliverability | false | false | true |
| `get_run` | Get a run | true | false | false |
| `list_credentials` | List stored vendor keys | true | false | false |
| `put_credentials` | Store a vendor key | false | false | false |
| `delete_credentials` | Delete a vendor key | false | true | false |
| `delete_subject` | Erase a subject | false | true | false |
| `list_webhooks` | List webhooks | true | false | false |
| `create_webhook` | Create a webhook | false | false | false |
| `get_webhook` | Get a webhook | true | false | false |
| `patch_webhook` | Update a webhook | false | false | false |
| `delete_webhook` | Delete a webhook | false | true | false |
| `rotate_webhook_secret` | Rotate webhook secret | false | true | false |
| `test_webhook` | Send a test webhook | false | false | false |
| `list_webhook_deliveries` | List webhook deliveries | true | false | false |
| `replay_webhook_delivery` | Replay a webhook delivery | false | false | false |
| `list_events` | List platform events | true | false | false |
| `submit_feedback` | Submit product feedback | false | false | false |

Admin titles (still no directory): Abuse report, Partner report, Partner payout, Feedback report, Partner admin.

Lookups stay `openWorldHint: true` (open-ended entities). Workspace-bounded reads/writes stay `false`.

---

## 5. Steps only Harris can do

Do not have an agent create accounts, spend money, set Cloudflare secrets, or mint prod users without his word.

### 5.1 Directory / identity

1. **OpenAI** org/business verification in Platform settings; Apps Management Write (or owner). Domain challenge token → secret for C4.
2. **Paid Claude plan** on the submitting account (`claude.ai/directory/manage`).
3. **Meta / Muse** business verification, brand assets, data-processing questionnaire — only if D8 says Muse is in this push.
4. **Smithery / Glama / mcp.so / Cursor Marketplace / registry republish** sign-in and submit (public actions). mcp.so: pay $39 or open the public GitHub issue (D4).
5. **Registry DNS key** `/home/box/secrets/mcp_registry_ed25519.pem` — republish after A3. Do not commit the key.
6. **xAI grok.com** partner outreach — only if D8.

### 5.2 Cloudflare / prod infra (design §12)

1. Create KV namespace, bind as **`OAUTH_KV`** on `kingminos-api-prod`.
2. Service binding: MCP Worker `AUTH_SERVER` → API Worker `validateToken` entrypoint.
3. Secrets: OAuth cookie/signing keys the library needs; OpenAI challenge token; Sentry remains as today. Never put tokens in `wrangler.jsonc` `vars`.
4. Flag `OAUTH_ENABLED` (or equivalent) on API, then MCP.
5. `global_fetch_strictly_public` on the API Worker for CIMD.
6. Confirm custom domains: `api.kingminos.com`, `mcp.kingminos.com`, `app.kingminos.com`.

### 5.3 Reviewer account (Edgar gates)

1. Approve creating a **prod** reviewer workspace (not a copy of a customer).
2. Comp credits; seed sample companies/people/runs (hit + miss).
3. Password login (B6): login + password, no MFA, works immediately — OpenAI requirement.
4. Confirm every directory-subset tool has been run in Inspector or Claude before submit.
5. Credentials go in the **portal only**.

### 5.4 Copy and legal (not Harris-solo, but he unblocks)

- Dante: listings copy, 3 starter prompts ≤128 chars, 5 positive + 3 negative test cases, demo video (needs working OAuth), release notes, categories.
- Edgar: privacy vs OpenAI minimums; Claude data-handling (own API vs proxied partners with permission) + 7 acknowledgments; Muse questionnaire; sign-off on the reviewer account; “authorized access / not an unofficial pass-through” answer.

---

## 6. Open decisions (each with a recommendation)

Re-read design §12 for the original three Harris items; several were closed in #325 (member levels, §9.4 matrix). These remain.

| ID | Decision | Recommendation |
| --- | --- | --- |
| **D1** | Vendor names on public MCP/skills/README surfaces (open since 2026-10-24). | **Remove** BYOK and house-key vendor lists from server `instructions`, `put_credentials` description, `kingminos-mcp` README, and `kingminos-skills` README. Recipe rule. Keep vendor names inside the authenticated app Your Keys UI and inside `get_providers` **values** (those are the API contract; do not strip OpenAPI enums). |
| **D2** | Submit no-OAuth directories (registry, Smithery, Glama, mcp.so, Cursor API-key, skills.sh) before ChatGPT/Claude/Muse? | **Yes.** Wave A unblocks them. OAuth directories wait for Wave D. |
| **D3** | Cursor package: new public repo vs folder in `kingminos-mcp`? Submit API-key listing now vs wait for OAuth? | **Folder in `kingminos-mcp`** (`.cursor-plugin/`) — one public repo, already listed on the registry. Submit API-key listing after A6 for teams; add OAuth in a plugin revision after C1. |
| **D4** | mcp.so: $39 vs GitHub issue. | **Pay $39** if Harris wants it listed this month; the free issue path has ~month-scale review. |
| **D5** | Registry republish after A3. | **Yes**, with Harris OK: new CalVer, router description, icons, Authorization header. |
| **D6** | OAuth start: when to begin Wave B. | **Start B1 as soon as Wave A is in review**, on a feature flag, without enabling AS metadata on prod until KV is bound. |
| **D7** | Directory tool subset. | **Adopt §4.1.** Hide `put_credentials`, `delete_credentials`, `list_credentials`, all webhook tools, `delete_subject`, ledger/forecast/history, and `get_usage` from ChatGPT and Claude. Cursor/API-key keep the full 40. |
| **D8** | Muse + xAI in this push? | **Muse: yes, same OAuth stack**, submit after Claude if verification is ready; add Read Only grant only if the Muse form requires it (lookups are POSTs — document that Read Only = catalog + balance + get_run, no billed POSTs). **xAI catalog: no** (no public form); leave custom-connector docs. |
| **D9** | `glama.json` maintainer GitHub username. | **`osiharris`** (Harris’s GitHub), unless he names another. |
| **D10** | Unknown DCR clients: full tools or directory subset? | **Directory subset** (fail closed). `put_credentials` must not leak to a random DCR client. |
| **D11** | Where OAuth HTML consent is rendered (API Worker vs website). | **API Worker `/authorize`** as designed (bounce to app for login). Website only supplies CSS/brand if needed; do not put the AS on `app.kingminos.com`. |
| **D12** | OpenAI plugin ZIP in `kingminos-mcp` vs `kingminos-website`. | **Website `public/` or a `listings/` folder on the website** (brand assets already live there). MCP repo stays the protocol server. |

### Unverified (do not guess in implementation)

- How Glama claim works today (`glama.json` assumed).
- Whether individual Cursor users can set plugin variables.
- Cursor / OpenAI / Muse review SLAs (unpublished).
- Exact #325 member-level matrix and the original three §12 Harris questions — **re-read the design doc**.
- Whether `workers-oauth-provider` 1.2.4+ is already a dependency on `kingminos-application` (this token cannot see that repo).

---

## 7. What this PR is not

- Not an OAuth implementation.
- Not a directory submission.
- Not a change to tool handlers, OpenAPI, or wrangler bindings.
- Not permission to merge Waves B–D to `main`.

When implementation starts, open **separate** PRs per row above, against the owning repo, with the tests listed. Re-read `kingminos-application/docs/mcp-oauth-design.md` on day one of B1.
