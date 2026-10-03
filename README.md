# KingMinos by OutboundSync — MCP

Streamable HTTP MCP server that wraps the live KingMinos enrichment API at `https://api.kingminos.com`. One tool per authenticated resource route. This is not the OutboundSync product MCP and does not expose OutboundSync account, source, or sync tools.

LeadMagic is the only house-key vendor. ZoomInfo, Findymail, Wiza, AI Ark, and BuiltWith are BYOK via `put_credentials`. Websearch is house-only and cannot be stored. The server never embeds vendor keys and never logs the tenant Bearer or credential bodies.

Say **SFDC**, never SF.

## Production host

Production is Cloudflare Worker **`kingminos-mcp-prod`** on the existing OutboundSync Cloudflare account. Janus deploys it with Wrangler:

```bash
npx wrangler deploy
```

Documented public hostname: `https://mcp.kingminos.com`. That name is **not attached yet** — do not treat DNS as live. After deploy, the Worker answers on its `workers.dev` URL. Attaching `mcp.kingminos.com` is a separate zone/DNS step (Custom Domain or proxied CNAME). This repo does not put a zone route in `wrangler.jsonc` because the deploy token may not be able to change the zone.

This Worker must not bind D1 `outboundsync-router`, R2 `outboundsync-router-raw`, or Worker `outboundsync-router`. API base stays `https://api.kingminos.com`.

Fly is not the production host. `fly.toml` / `Dockerfile` are a local Node fallback only.

| Path | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /` | Service card |
| `GET /.well-known/mcp/server-card.json` | MCP server card (advertises `https://mcp.kingminos.com/mcp`) |
| `POST /mcp` | Streamable HTTP MCP |

## Run it locally

Requires Node 20+.

```bash
npm install
npm run build
npm start
```

The process listens on `PORT` (default `8080`) and serves the same paths as the Worker.

Dev (tsx, no build):

```bash
npm run dev
```

Contract check (advertised tools vs the KingMinos OpenAPI inventory — live `GET /openapi.json` when that document has resource `operationId`s, otherwise `inventory/openapi-surfaces.json`):

```bash
npm run check:surfaces
```

Application CI can point at its own inventory with `KINGMINOS_OPENAPI_INVENTORY=/path/to/openapi-surfaces.json`. This repo does not vendor KingMinos application source.

Smoke (starts an ephemeral listener and lists tools):

```bash
npm test
npm run smoke
```

Worker bundle check (no Cloudflare auth required):

```bash
npm run check:worker
```

## Tenant Bearer

The KingMinos tenant Bearer is sent by the client as **`Authorization: Bearer <token>`**. The server never mints, embeds, or logs that value.

If that header is absent, a local Node process may fall back to `KINGMINOS_API_KEY` in the process environment. Production Workers do not store this secret. The value is never printed here.

Optional:

- `KINGMINOS_API_URL` — API base (default `https://api.kingminos.com`)
- `PORT` — local Node listen port (default `8080`)
- `KINGMINOS_MCP_ALLOWED_HOSTS` — comma-separated Host allowlist for `/mcp` (empty = allow all)
- `KINGMINOS_MCP_PUBLIC_URL` — advertised MCP URL on the server card (Worker default `https://mcp.kingminos.com/mcp`)

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

Hosted (after `mcp.kingminos.com` is attached):

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

Every tool is the snake_case `operationId` of one KingMinos resource route. `/health` and `/openapi.yaml` (`/openapi.json` when published) are not tools.

| Tool | Route | Notes |
| --- | --- | --- |
| `get_providers` | `GET /v1/providers` | Registry + configured flags |
| `get_capabilities` | `GET /v1/capabilities` | Call before the first resolve |
| `company_resolve` | `POST /v1/company/resolve` | Email / domain / website. Name-only is `no_decision` |
| `company_domain` | `POST /v1/company/domain` | Write-safe CRM domain decision |
| `company_hierarchy` | `POST /v1/company/hierarchy` | Immediate / ultimate parent + capped subsidiaries |
| `person_verify_employment` | `POST /v1/person/verify-employment` | LeadMagic default; Findymail is BYOK-only |
| `get_run` | `GET /v1/runs/{id}` | Recorded run envelope |
| `put_credentials` | `PUT /v1/credentials/{provider}` | Tenant Your Keys (ciphertext). Confirm first |
| `delete_credentials` | `DELETE /v1/credentials/{provider}` | Revoke Your Keys. Confirm first |
| `delete_subject` | `DELETE /v1/subjects/{subject_key}` | Needs `erase` scope. Confirm first |

Capability POSTs spend credits and write runs even though they do not write SFDC. Confirm `put_credentials`, `delete_credentials`, and `delete_subject` with the user. CI fails if this list drifts from the OpenAPI inventory.

## What this could not mirror from `outboundsync/mcp`

This environment could not clone the private `outboundsync/mcp` or `outboundsync/kingminos-application` repos (GitHub token is scoped to `kingminos-mcp`). Structure is reconstructed from the live OutboundSync MCP (`https://mcp.outboundsync.com`), website MCP setup docs, and Linear OS-653 / OS-1258:

- Streamable HTTP, `/health`, server card, one tool per live resource route, Bearer forwarded to the API, Cursor `${env:…}` packaging, read/write/destructive/open-world hints, and the same error `code` vocabulary (`auth_required`, `unauthorized`, `forbidden`, `bad_request`, `not_found`, `rate_limited`, `timeout`, `upstream_error`).
- Production host here is Worker `kingminos-mcp-prod` (same `*-prod` pattern as `kingminos-api-prod`), not Fly.
- Not mirrored: private repo file layout and internal module names, Cloudflare account secrets, `AGENTS.md` / FUTURE docs, website/DNS-AID discovery, harness plugins, and the exact OutboundSync `apiRequest` source. Tool names are the KingMinos resource `operationId`s. `.github/workflows/ci.yml` runs `check:surfaces` against the OpenAPI inventory.
