# KingMinos by OutboundSync — MCP

Streamable HTTP MCP server that wraps the live KingMinos enrichment API at `https://api.kingminos.com`. One tool per bearer-authenticated resource route. Session and cookie routes under `/v1/auth/*` and `/v1/account/*` are permanently out of scope. This is not the OutboundSync product MCP and does not expose OutboundSync account, source, or sync tools.

LeadMagic, Wiza, and Findymail are the approved house-key vendors. ZoomInfo, AI Ark, BuiltWith, Prospeo, and Apollo are BYOK via `put_credentials`. Websearch is house-only and cannot be stored. The server never embeds vendor keys and never logs the tenant Bearer or credential bodies.

Say **SFDC**, never SF.

## Production host

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
| `GET /.well-known/mcp/server-card.json` | MCP server card (advertises `https://mcp.kingminos.com/mcp`) |
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

`check:surfaces` compares advertised MCP tools to `operations[]`. `check:providers` compares the Zod `ProviderName` / `CredentialProvider` enums to the pinned `providers[]` / `credentialProviders[]`. A new BYOK id such as `prospeo` fails CI until both Zod enums and the pin list it — that is how `routing.only: ["prospeo"]` and `put_credentials({ provider: "prospeo" })` stay accepted.

`/v1/auth/*` and `/v1/account/*` are intentionally not MCP tools (cookie/session app surfaces). They are denied by `nonToolPathPrefixes` plus the reviewed `excludedOperationIds` catalog. Do not implement those ~24 operations as tools.

Live OpenAPI drift check (scheduled CI / `workflow_dispatch`, or local). Surfaces compare only bearer resource operations after the deny-list — account/auth on the live spec is not a failure. Provider live check is one-way: it fails only when production lists a provider Zod does not have. Production lagging the pin (missing `prospeo`) does not fail. Override the spec URL with `KINGMINOS_OPENAPI_JSON_URL` (default `https://api.kingminos.com/openapi.json`):

```bash
npm run check:surfaces:live
npm run check:providers:live
```

Refresh the pin from live OpenAPI (network). Unions provider enums and newly seen auth/account operationIds; never drops pinned providers. Review the diff before committing:

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
| `company_resolve` | `POST /v1/company/resolve` | Email / domain / website. Spends credits unless `dry_run` is true (API default false). Name-only is `no_decision` |
| `company_domain` | `POST /v1/company/domain` | Write-safe CRM domain decision |
| `company_hierarchy` | `POST /v1/company/hierarchy` | Immediate / ultimate parent + capped subsidiaries |
| `person_verify_employment` | `POST /v1/person/verify-employment` | LeadMagic default; Findymail is BYOK-only |
| `get_run` | `GET /v1/runs/{id}` | Recorded run envelope |
| `list_credentials` | `GET /v1/credentials` | Masked Your Keys catalog. Never returns raw keys |
| `put_credentials` | `PUT /v1/credentials/{provider}` | Tenant Your Keys (ciphertext). Confirm first. The key will be visible in this conversation; prefer the web app at https://app.kingminos.com/app/keys/ |
| `delete_credentials` | `DELETE /v1/credentials/{provider}` | Revoke Your Keys. Confirm first |
| `delete_subject` | `DELETE /v1/subjects/{subject_key}` | Raw unencoded key (e.g. `email:a@b.com`). Needs `erase` scope. Confirm first |

Capability POSTs spend credits and write runs even though they do not write SFDC. Confirm `put_credentials`, `delete_credentials`, and `delete_subject` with the user. CI fails if this list drifts from the OpenAPI inventory.
