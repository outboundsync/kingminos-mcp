# KingMinos by OutboundSync — MCP

Streamable HTTP MCP server that wraps the live KingMinos enrichment API at `https://api.kingminos.com`. One tool per authenticated resource route. This is not the OutboundSync product MCP and does not expose OutboundSync account, source, or sync tools.

LeadMagic is the only house-key vendor. ZoomInfo, Findymail, Wiza, AI Ark, and BuiltWith are BYOK via `put_credential`. Websearch is house-only and cannot be stored. The server never embeds vendor keys and never logs the tenant Bearer or credential bodies.

Say **SFDC**, never SF.

## Run it

Requires Node 20+.

```bash
npm install
npm run build
npm start
```

The process listens on `PORT` (default `8080`):

| Path | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /` | Service card |
| `GET /.well-known/mcp/server-card.json` | MCP server card |
| `POST /mcp` | Streamable HTTP MCP |

Dev (tsx, no build):

```bash
npm run dev
```

Smoke (starts an ephemeral listener, lists tools, diffs them against live `GET /openapi.yaml`):

```bash
npm test
```

## Tenant Bearer

The KingMinos tenant Bearer is read from **`KINGMINOS_API_KEY`**.

Cursor and other MCP clients should send it as `Authorization: Bearer <token>`. If that header is absent, the server falls back to `KINGMINOS_API_KEY` in the process environment. The value is never printed here.

Optional:

- `KINGMINOS_API_URL` — API base (default `https://api.kingminos.com`)
- `PORT` — listen port (default `8080`)
- `KINGMINOS_MCP_ALLOWED_HOSTS` — comma-separated Host allowlist for production
- `KINGMINOS_MCP_PUBLIC_URL` — advertised MCP URL on the server card

Copy `.env.example` for local names only. Do not commit a filled `.env`.

## Cursor

Add to `~/.cursor/mcp.json` (or project `.cursor/mcp.json`):

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

Cursor GUI sessions do not inherit shell `.env` files. Export `KINGMINOS_API_KEY` into the GUI environment so `${env:KINGMINOS_API_KEY}` resolves.

Point `url` at a hosted deployment when you have one. Hosted OutboundSync MCP uses the same `url` + `Authorization: Bearer ${env:…}` shape.

## Tools

Every tool maps to one live KingMinos route from `GET /openapi.yaml`. `/health` and `/openapi.yaml` are not tools.

| Tool | Route | Notes |
| --- | --- | --- |
| `get_providers` | `GET /v1/providers` | Registry + configured flags |
| `get_capabilities` | `GET /v1/capabilities` | Call before the first resolve |
| `resolve_company` | `POST /v1/company/resolve` | Email / domain / website. Name-only is `no_decision` |
| `decide_company_domain` | `POST /v1/company/domain` | Write-safe CRM domain decision |
| `decide_company_hierarchy` | `POST /v1/company/hierarchy` | Immediate / ultimate parent + capped subsidiaries |
| `verify_employment` | `POST /v1/person/verify-employment` | LeadMagic default; Findymail is BYOK-only |
| `get_run` | `GET /v1/runs/{id}` | Recorded run envelope |
| `put_credential` | `PUT /v1/credentials/{provider}` | Tenant Your Keys (ciphertext). Confirm first |
| `delete_credential` | `DELETE /v1/credentials/{provider}` | Revoke Your Keys. Confirm first |
| `erase_subject` | `DELETE /v1/subjects/{subject_key}` | Needs `erase` scope. Confirm first |

Capability POSTs spend credits and write runs even though they do not write SFDC. Confirm `put_credential`, `delete_credential`, and `erase_subject` with the user.

## What this could not mirror from `outboundsync/mcp`

This environment could not clone the private `outboundsync/mcp` or `outboundsync/kingminos-application` repos (GitHub token is scoped to `kingminos-mcp`). Structure is reconstructed from the live OutboundSync MCP (`https://mcp.outboundsync.com`), website MCP setup docs, and Linear OS-653 / OS-1258:

- Streamable HTTP, `/health`, server card, Dockerfile, `fly.toml` (iad, always-on), one tool per live resource route, Bearer forwarded to the API, Cursor `${env:…}` packaging, read/write/destructive/open-world hints, and the same error `code` vocabulary (`auth_required`, `unauthorized`, `forbidden`, `bad_request`, `not_found`, `rate_limited`, `timeout`, `upstream_error`).
- Not mirrored: private repo file layout and internal module names, Fly org/app secrets, CI workflows, `AGENTS.md` / FUTURE docs, website/DNS-AID discovery, harness plugins, and the exact OutboundSync `apiRequest` source. Tool names and schemas are KingMinos-only, from live `GET https://api.kingminos.com/openapi.yaml`.
