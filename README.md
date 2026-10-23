# KingMinos by OutboundSync — MCP

Streamable HTTP MCP server that wraps the live KingMinos enrichment API at `https://api.kingminos.com`. One tool per bearer-authenticated resource route. Session and cookie routes under `/v1/auth/*` and `/v1/account/*` are permanently out of scope. This is not the OutboundSync product MCP and does not expose OutboundSync account, source, or sync tools.

LeadMagic, Wiza, Findymail, and AI Ark are the approved house-key vendors. ZoomInfo, BuiltWith, Prospeo, Apollo, Company URL Finder, People Data Labs, HG Insights, Brandfetch, Enrich-CRM, Lemlist, and Snov.io are BYOK via `put_credentials`. Websearch is house-only and cannot be stored. Snov.io is OAuth (`clientId`/`clientSecret`) and is a credential vendor only. Cognism, Lusha, Starbridge, Clay, Databar, QuickEnrich, GetLeads, and BlitzAPI are API-key credential vendors only — no routing hop yet. The server never embeds vendor keys and never logs the tenant Bearer or credential bodies.

Say **SFDC**, never SF.

**BYOK provider rollout:** four-repo checklist and narrative live in [`docs/byok-provider-playbook.md`](docs/byok-provider-playbook.md); Cursor agents can load [`.cursor/skills/byok-provider-rollout/SKILL.md`](.cursor/skills/byok-provider-rollout/SKILL.md).

## Production host

## Admin tools (admin token only)

`abuse_report`, `partner_report`, `partner_payout`, `feedback_report` and `partner_admin` wrap `/v1/admin/abuse/daily`, `/v1/admin/partners/analytics`, `/v1/admin/partners/payouts`, `/v1/admin/feedback` and `/v1/admin/partners` (list, create partner + code, add/deactivate code). They are registered **only** when the MCP bearer is a KingMinos admin token (`kmadm_…`, hashed in the API's D1, minted by Harris with `scripts/mint-admin-token.ts` in kingminos-application). Any other bearer never sees them in `tools/list`; an admin bearer sees only these admin tools. The API re-checks the token on every call. They are not OpenAPI resource operations, so `check:surfaces` ignores them.

Production is Cloudflare Worker **`kingminos-mcp-prod`** on the existing OutboundSync Cloudflare account. Janus deploys it with Wrangler:

```bash
npx wrangler deploy
```

Production MCP URL: **`https://mcp.kingminos.com/mcp`**. The custom domain `mcp.kingminos.com` is attached in Cloudflare and tracked in `wrangler.jsonc` (`routes` with `custom_domain: true`) so Janus deploys keep the hostname. `workers_dev` is **false**, so the Worker is not published on `*.workers.dev` (custom domain only).

This Worker must not bind D1 `outboundsync-router`, R2 `outboundsync-router-raw`, or Worker `outboundsync-router`. API base stays `https://api.kingminos.com`.

Fly is not the production host. `fly.example.toml` / `Dockerfile` are a local Node fallback sample only — not a production config.

| Path | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /` | Service card |
| `GET /.well-known/mcp/server-card.json` | MCP server card (advertises `https://mcp.kingminos.com/mcp`, plus `privacy_url` / `terms_url`) |
| `POST /mcp` | Streamable HTTP MCP |
| `OPTIONS /mcp` | Advertises `Allow: POST, OPTIONS` |
| `GET` / `DELETE /mcp` | `405 Method Not Allowed` |

## Run it locally

Requires Node 22.

```bash
npm install
npm run build
npm start
```

The process listens on `HOST` (default `127.0.0.1`) and `PORT` (default `8080`) and serves the same paths as the Worker.

Dev (tsx, no build):

```bash
npm run dev
```

Contract check against the vendored inventory (`inventory/openapi-surfaces.json`). Deterministic; no live network. Default PR CI uses this pin — it does not fetch production OpenAPI.

```bash
npm run check:surfaces
npm run check:providers
```

`check:surfaces` compares advertised MCP tools to `operations[]`. `check:providers` compares the Zod `ProviderName` / `CredentialProvider` enums to the pinned `providers[]` / `credentialProviders[]`. A new BYOK id such as `prospeo`, `companyurlfinder`, `peopledatalabs`, `hginsights`, `brandfetch`, `enrichcrm`, or `lemlist` fails CI until both Zod enums and the pin list it — that is how `routing.only: ["prospeo"]` and `put_credentials({ provider: "prospeo" })` stay accepted.

`/v1/auth/*` and `/v1/account/*` are intentionally not MCP tools (cookie/session app surfaces). They are denied by `nonToolPathPrefixes` plus the reviewed `excludedOperationIds` catalog. Do not implement those ~24 operations as tools.

Live OpenAPI drift check (scheduled CI / `workflow_dispatch`, or local). Surfaces compare only bearer resource operations after the deny-list — account/auth on the live spec is not a failure. Provider live check is one-way: it fails only when production lists a provider Zod does not have. Production lagging the pin (missing `prospeo`) does not fail. Override the spec URL with `KINGMINOS_OPENAPI_JSON_URL` (default `https://api.kingminos.com/openapi.json`):

```bash
npm run check:surfaces:live
npm run check:providers:live
```

Refresh the pin from live OpenAPI (network). Unions provider enums and newly seen auth/account operationIds; never drops pinned providers. Credential-only vendors (snovio, cognism, lusha, starbridge, clay, databar, quickenrich, getleads, blitzapi — no routing hop) are skipped from `providers[]`; the hand-written `capabilityProviders` pin is preserved. Review the diff before committing:

```bash
npm run inventory:refresh
```

Application CI can point at its own inventory with `KINGMINOS_OPENAPI_INVENTORY=/path/to/openapi-surfaces.json`. This repo does not vendor KingMinos application source.

Smoke (starts an ephemeral listener and lists tools; uses the file inventory, not the live spec):

```bash
npm test
npm run smoke
```

Worker bundle check (no Cloudflare auth required):

```bash
npm run check:worker
```

Full local suite:

```bash
npm run ci
```

That is exactly what the required `OpenAPI tool contract` check runs on PRs and `main` (branches must be up to date; protection applies to admins, so no direct pushes to `main`). `npm install` also installs git hooks (`simple-git-hooks`): pre-commit runs `biome check --write` on staged files, pre-push runs typecheck + tests. The nightly live drift job opens a `Live OpenAPI drift` issue instead of blocking PRs. CI map for all kingminos-* repos: [`kingminos-application/docs/ci.md`](https://github.com/outboundsync/kingminos-application/blob/main/docs/ci.md).

## Tenant Bearer

The KingMinos tenant Bearer is sent by the client as **`Authorization: Bearer <token>`**. The server never mints, embeds, or logs that value.

Worker mode never reads `KINGMINOS_API_KEY` from `process.env` or from Worker bindings. A missing `Authorization` header is always 401 on the Worker.

A local Node process may fall back to `KINGMINOS_API_KEY` only when **all** of these are true:

- the process is bound to loopback (`127.0.0.1`, `localhost`, or `::1`)
- `KINGMINOS_MCP_ALLOW_ENV_BEARER=1`

Production Workers do not store this secret. The value is never printed here.

`POST /mcp` rejects a present `Origin` that is not allowlisted. Clients that send no `Origin` keep working (typical MCP clients hitting `https://mcp.kingminos.com/mcp`). Local default hosts are `localhost`, `127.0.0.1`, and `[::1]`; production also admits `mcp.kingminos.com`.

Optional:

- `KINGMINOS_API_URL` — API base (default `https://api.kingminos.com`). Path prefixes on this URL are preserved.
- `HOST` — local Node listen address (default `127.0.0.1`)
- `PORT` — local Node listen port (default `8080`)
- `KINGMINOS_MCP_ALLOWED_HOSTS` — comma-separated Host allowlist for `/mcp` (Node default = loopback; Worker empty = allow all)
- `KINGMINOS_MCP_ALLOWED_ORIGINS` — extra Origin hostnames for `/mcp`
- `KINGMINOS_MCP_PUBLIC_URL` — advertised MCP URL on the server card (Worker default `https://mcp.kingminos.com/mcp`). The card never uses the client `Host` header.
- `KINGMINOS_MCP_ALLOW_ENV_BEARER` — set to `1` to opt in to the local loopback env-bearer fallback
- `KINGMINOS_OPENAPI_INVENTORY` — path to the file inventory used by `check:surfaces`, `check:providers`, and PR CI
- `KINGMINOS_OPENAPI_JSON_URL` — override URL for `check:surfaces:live` / `check:providers:live` / `inventory:refresh`

Copy `.env.example` for local names only. Do not commit a filled `.env`. Do not put secrets in Wrangler vars or files.

## Cursor

Add to `~/.cursor/mcp.json` (or project `.cursor/mcp.json`).

Local:

```json
{
  "mcpServers": {
    "kingminos": {
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer ${env:KINGMINOS_API_KEY}"
      }
    }
  }
}
```

Hosted (production):

```json
{
  "mcpServers": {
    "kingminos": {
      "url": "https://mcp.kingminos.com/mcp",
      "headers": {
        "Authorization": "Bearer ${env:KINGMINOS_API_KEY}"
      }
    }
  }
}
```

Cursor GUI sessions do not inherit shell `.env` files. Export `KINGMINOS_API_KEY` into the GUI environment so `${env:KINGMINOS_API_KEY}` resolves.

## Tools

Every tool is the snake_case `operationId` of one bearer-authenticated KingMinos resource route. `/health`, OpenAPI docs, and session/cookie `/v1/auth/*` + `/v1/account/*` routes are not tools.

| Tool | Route | Notes |
| --- | --- | --- |
| `get_providers` | `GET /v1/providers` | Registry + configured flags |
| `get_capabilities` | `GET /v1/capabilities` | Call before the first resolve |
| `get_recipes` | `GET /v1/recipes` | Agent chaining recipes; ask speed / balance / accuracy / coverage before a bulk run |
| `company_resolve` | `POST /v1/company/resolve` | Email / domain / website. Spends credits unless `dry_run` is true (API default false). Name-only is `no_decision`. `result.operator` (0 credits) names a product brand's operator (fizzy.do → 37signals) without changing `company_name` |
| `company_domain` | `POST /v1/company/domain` | Write-safe CRM domain decision |
| `company_hierarchy` | `POST /v1/company/hierarchy` | Immediate / ultimate parent + capped subsidiaries |
| `company_b2b_social` | `POST /v1/company/b2b-social` | LinkedIn company page URL; balance = websearch → house AI Ark; accuracy/coverage stack LeadMagic / AI Ark / Wiza / Findymail |
| `company_icon` | `POST /v1/company/icon` | Required `domain`, optional `name` (no routing/path/preset; no website/email); on hit `result.icon_url` is always `https://logos.kingminos.com/i/<sha256>.png` (256×256 R2); optional `result.icon_source_url`; source under 64px → hosted hit with `confidence` low, `flags.low_res`, `safe_to_write.icon_url` true; rejects wrong-company/junk/empty only; fetch/store fail → `icon_url` null; ladder = favicon-fetch (0) → Brandfetch BYOK (1) → ZoomInfo (1) |
| `company_description` | `POST /v1/company/description` | English `result.description` or null (max_chars 80–500, default 300); always pass `path` (omit → balance at cap 6; `path: balance` → cap 2); paths `speed` (meta/og → AI Ark) \| `balance` (Jev-ranked extracts + AI Ark + optional rewrite) \| `accuracy` (xAI compose) \| `coverage` (compose + Serper / ZoomInfo BYOK); flags `hype` / `first_person` / `tagline` / `same_as_speed` / `truncated` / `cta` / `grammar` (may gain keys — tolerate unknowns; truncated/cta → `low`; `grammar` informational only); cache bypass via `skip_cache` or `cache_bypass` (not Idempotency-Key replay; `company.resolve` ignores bypass); `answer.confidence`, `answer.identity`; `safe_to_write.description` only on non-low + identity; winner-only billing; AI Ark only firmographic vendor |
| `person_verify_employment` | `POST /v1/person/verify-employment` | LeadMagic default; Findymail is house-key via `routing.only` |
| `person_language` | `POST /v1/person/language` | Can we engage in English, and if not, which language? `email` or `linkedin_url` required (names are match-only); `result.english` yes \| likely \| unconfirmed \| unknown, `recommended_language` / `local_language` at medium+ only; `routing.path` speed (cap 1) \| balance (default, cap 3) \| accuracy (cap 4), `coverage` is `400 invalid_routing`; `skip_cache` / `cache_bypass` |
| `person_phone` | `POST /v1/person/phone` | One dialable phone for a person by work email or LinkedIn URL. `email` or `linkedin_url` required (names are match-only); `phone_types` (mobile \| landline \| other \| unknown, omit = any) and `max_results` (1–10, default 3); `result.best_phone` {number (E.164), type, source} or null, ranked `result.phones` (mobile first), `result.flags` `conflicting_numbers` blocks `safe_to_write.best_phone`; Agent-managed router, answers in < 10 s: every eligible vendor (ZoomInfo / QuickEnrich / Blitz BYOK, LeadMagic, AI Ark, Findymail US-only, Wiza) runs in parallel under a ~8.5 s budget; late vendors are dropped (bill 0). Four modes via `routing.path`: `speed` (LeadMagic first with a 3 s head start, then the cheapest fallbacks race it; cap 10, never Wiza), `balance` (default: best single number by vendor prior / region / line type, no waiting for agreement), `accuracy` (agreement required, exactly one number; `conflicting_numbers` → not safe), `coverage` (up to 5 ranked numbers, each with source, line type, confidence, consensus). `consensus` and `do_not_call` on every number; `routing.only` / `ignore` filter the pool. Only vendors behind returned numbers bill (coverage: each returned number), capped at 38 credits; 0 on a miss; BYOK 0.1; 30-day cache, `skip_cache` / `cache_bypass`; API tenants only; numbers are contact PII |
| `person_title` | `POST /v1/person/title` | A person's current title, seniority and function by work email or LinkedIn URL. `email` or `linkedin_url` required (names and `company_domain` are match-only); `fields` (title \| seniority \| function, omit = all) drives the ladder; `routing.path` speed \| balance (default) \| accuracy \| coverage — outcome-priced 1 / 2 / 3 / 5 credits on a hit, 0 on a miss or partial (`fields_incomplete`); ZoomInfo search only on a BYOK key; `safe_to_write.title` / `seniority` / `function` false on `conflicting_titles` / `unconfirmed_identity` / `employer_mismatch`; 30-day cache, `skip_cache` / `cache_bypass`; API tenants only |
| `get_run` | `GET /v1/runs/{id}` | Recorded run envelope |
| `list_credentials` | `GET /v1/credentials` | Masked Your Keys catalog. Never returns raw keys |
| `put_credentials` | `PUT /v1/credentials/{provider}` | Tenant Your Keys (ciphertext). Confirm first. The key will be visible in this conversation; prefer the web app at https://app.kingminos.com/app/keys/ |
| `delete_credentials` | `DELETE /v1/credentials/{provider}` | Revoke Your Keys. Confirm first |
| `delete_subject` | `DELETE /v1/subjects/{subject_key}` | Raw unencoded key (e.g. `email:a@b.com`). Needs `erase` scope. Confirm first |
| `list_webhooks` | `GET /v1/webhooks` | Workspace endpoints (`kmwhk_…`). `403 webhooks_not_enabled` while the workspace gate is off. Every webhook tool needs a key with the explicit `webhooks` scope (`403 webhook_scope_required` otherwise). Never returns secrets |
| `create_webhook` | `POST /v1/webhooks` | HTTPS only; private/loopback targets rejected; max 20 per workspace. Signing secret (`kmwhsec_…`) shown once. Owner only. Confirm first |
| `get_webhook` | `GET /v1/webhooks/{id}` | One endpoint: `is_active`, `consecutive_failures`, `auto_disabled_at`. No secret |
| `patch_webhook` | `PATCH /v1/webhooks/{id}` | `url` / `description` / `enabled_events` / `is_active`; `is_active: true` re-enables after auto-disable. Owner only. Confirm first |
| `delete_webhook` | `DELETE /v1/webhooks/{id}` | Soft delete. Owner only. Confirm first |
| `rotate_webhook_secret` | `POST /v1/webhooks/{id}/rotate-secret` | Previous secret stops working immediately (no grace); new secret returned once. Owner only. Confirm first |
| `test_webhook` | `POST /v1/webhooks/{id}/test` | Signed `test.ping` (`202 { event_id }`); `409 webhook_endpoint_inactive` while paused. Owner only. Confirm first |
| `list_webhook_deliveries` | `GET /v1/webhooks/{id}/deliveries` | `status` pending \| succeeded \| failed \| dead, `last_http_status`, `last_error`; limit ≤ 100 |
| `replay_webhook_delivery` | `POST /v1/webhooks/{id}/deliveries/{delivery_id}/replay` | New delivery for the same event. Re-enable a paused endpoint first. Owner only. Confirm first |
| `list_events` | `GET /v1/events` | Reconciliation log; `type`, `delivered` (false = no successful delivery yet), limit ≤ 200, `next_cursor` only on a full page |

Capability POSTs spend credits and write runs even though they do not write SFDC. Confirm `put_credentials`, `delete_credentials`, `delete_subject`, and webhook mutations (`create_webhook`, `patch_webhook`, `delete_webhook`, `rotate_webhook_secret`, `test_webhook`, `replay_webhook_delivery`) with the user. CI fails if this list drifts from the OpenAPI inventory.

## Sentry

`src/worker.ts` is wrapped with `@sentry/cloudflare` `withSentry` (project
`outboundsync/kingminos-mcp`). Errors only (`tracesSampleRate: 0`); the SDK is
off unless the `SENTRY_DSN` secret is set (`wrangler secret put`, piped). No
request bodies, tool arguments, auth headers, cookies, query strings, emails,
LinkedIn URLs or `km*_` (incl. `kmadm_`, `kmwhsec_`) / `osr_` tokens leave the Worker
(`src/sentry.ts`). Release: `--var SENTRY_RELEASE:$(git rev-parse HEAD)` at
deploy, else the Worker version id.
