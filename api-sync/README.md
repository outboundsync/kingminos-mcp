# api-sync

`openapi.snapshot.json` is the live KingMinos API spec (`https://api.kingminos.com/openapi.json`) as of the last merged API sync PR, canonicalised with `jq -S .` (sorted keys, 2-space indent). The `API sync` workflow (`.github/workflows/api-sync.yml`) writes it; don't edit it by hand.

Every 6 hours the workflow fetches the live spec and compares it with this snapshot. When they differ, it refreshes `inventory/openapi-surfaces.json` from that same spec (`npm run inventory:refresh`, which also copies each capability's `x-kingminos-pricing` into the inventory and regenerates `src/pricing.generated.ts`), has a Cursor agent update the MCP tools (`.github/prompts/api-sync.md`), runs the `OpenAPI tool contract` checks and opens a PR on `chore/api-sync`. A human merges it, and Workers Builds then deploys `kingminos-mcp-prod`.

With no snapshot yet (bootstrap), the first run audits every tool against the full spec and its PR adds the snapshot.

The deterministic gate is the existing contract check: `npm run check:surfaces` (tools vs `operations[]` in the inventory) and `npm run check:providers` (Zod provider enums vs the pinned providers), in the required `OpenAPI tool contract` job.
