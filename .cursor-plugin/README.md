# KingMinos for Cursor

KingMinos by OutboundSync is a B2B data enrichment router. This plugin connects
Cursor (and Grok Bot **Connect apps**, which uses the same catalog) to the hosted
KingMinos MCP server at `https://mcp.kingminos.com/mcp`.

## Connect

1. Install **KingMinos** from the Cursor Marketplace.
2. Cursor opens a browser window. Sign in to KingMinos, pick the workspace, and
   approve access.
3. Ask for a lookup, for example "find the work email for Jane Doe at
   example.com".

Sign-in is OAuth only. There is no API key to paste. The plugin asks for
`offline_access` so Cursor can refresh the connection instead of asking you to
sign in again every hour.

## What it can do

- Resolve a company and decide its domain, hierarchy, social accounts, icon and
  description.
- Find a person's work email, title, phone, language and social profile;
  verify employment; verify an email address.
- Read the capability catalog, chaining recipes, your credit balance and past
  runs; send product feedback.

Lookups spend the connected workspace's credits. Misses are free. Each tool's
description shows its price.

Workspace admin tools (stored vendor keys, webhooks, data erasure, ledgers) are
not available over this connection; use the KingMinos app for those.

## Files

| File                         | Purpose                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `.cursor-plugin/plugin.json` | Cursor plugin manifest (`name: kingminos`, logo `assets/icon.svg`). |
| `.cursor-plugin/mcp.json`    | Remote server URL plus the static OAuth client (`auth`).            |

`auth.CLIENT_ID` is the static public client KingMinos registers for Cursor
(redirects `https://www.cursor.com/agents/mcp/oauth/callback` and
`http://localhost:8787/callback`). In this repo it is the placeholder
`REPLACE_WITH_CURSOR_CLIENT_ID`; replace it with the real client ID before the
plugin is submitted to the Marketplace.

Support: <support@outboundsync.com> · Privacy: <https://kingminos.com/privacy/>
· Terms: <https://kingminos.com/terms/>
