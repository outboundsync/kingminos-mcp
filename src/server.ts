import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LIVE_RESOURCE_ROUTES, type ToolName } from "./catalog.js";
import { PRODUCT_NAME, VERSION } from "./config.js";
import { toolErrorResult } from "./errors.js";
import { apiRequest, okText, requireBearer } from "./kingminos-client.js";
import {
  DecideCompanyDomainInput,
  DecideCompanyHierarchyInput,
  DeleteCredentialInput,
  EmptyInput,
  EraseSubjectInput,
  GetRunInput,
  PutCredentialInput,
  ResolveCompanyInput,
  stripMeta,
  VerifyEmploymentInput,
} from "./schemas.js";

export interface ToolContext {
  bearer?: string;
  signal?: AbortSignal;
}

function routerHeaders(meta: {
  explain?: string;
  schema?: string;
  idempotencyKey?: string;
  cacheBypass?: boolean;
}): Record<string, string | undefined> {
  return {
    "X-Router-Explain": meta.explain,
    "X-Router-Schema": meta.schema,
    "Idempotency-Key": meta.idempotencyKey,
    "X-Router-Cache": meta.cacheBypass ? "bypass" : undefined,
  };
}

function encodePath(template: string, params: Record<string, string>): string {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  return path;
}

export function createKingMinosServer(context: ToolContext): McpServer {
  const server = new McpServer(
    { name: "KingMinos", version: VERSION },
    {
      instructions: [
        `${PRODUCT_NAME} wraps the live enrichment API at https://api.kingminos.com.`,
        "Call get_capabilities before the first resolve so routing defaults are current.",
        "LeadMagic is the only house-key vendor. ZoomInfo, Findymail, Wiza, AI Ark, and BuiltWith are BYOK via put_credentials.",
        "Websearch is house-only and cannot be stored.",
        "Confirm with the user before put_credentials, delete_credentials, or delete_subject.",
        "Say SFDC, never SF. Branch automations on answer.outcome / es_decision — business misses stay HTTP 200.",
      ].join(" "),
    },
  );

  const bearerOf = (): string => requireBearer(context.bearer);

  server.registerTool(
    "get_providers",
    {
      description:
        "GET /v1/providers — static provider registry plus configured flags, billing_mode, and credit estimates. Does not start a run. LeadMagic is the only house-key vendor; other paid vendors are BYOK.",
      inputSchema: EmptyInput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (_args, extra) => {
      try {
        const payload = await apiRequest({
          method: "GET",
          path: "/v1/providers",
          bearer: bearerOf(),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_capabilities",
    {
      description:
        "GET /v1/capabilities — catalog for company.resolve, person.verify_employment, company.domain, and company.hierarchy (inputs, outcomes, hops, default routing). Call this before the first resolve. Does not start a run.",
      inputSchema: EmptyInput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (_args, extra) => {
      try {
        const payload = await apiRequest({
          method: "GET",
          path: "/v1/capabilities",
          bearer: bearerOf(),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "company_resolve",
    {
      description:
        "POST /v1/company/resolve — resolve a company from email, domain, or website (dry-run envelope). Name-only input is no_decision / no_domain. Default path is auto. A LeadMagic-only or websearch-only hit is resolved_without_primary_id — do not stamp a ZoomInfo id unless es_decision is hit and result.zoominfo_company_id is present. ZoomInfo / Findymail / Wiza / AI Ark need BYOK; LeadMagic is house-keyed. Does not write SFDC.",
      inputSchema: ResolveCompanyInput,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async (args, extra) => {
      try {
        const meta = stripMeta(args);
        const payload = await apiRequest({
          method: "POST",
          path: "/v1/company/resolve",
          bearer: bearerOf(),
          body: meta.body,
          query: { explain: meta.explain, schema: meta.schema },
          headers: routerHeaders(meta),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "company_domain",
    {
      description:
        "POST /v1/company/domain — decide what the CRM domain field should say and whether it is safe to write. Outcomes: verified | corrected | discovered | rejected | unverified | no_decision. Write-safe stamps live on result.account_primary_domain + additional_domains. coverage needs BuiltWith BYOK. Does not write SFDC.",
      inputSchema: DecideCompanyDomainInput,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async (args, extra) => {
      try {
        const meta = stripMeta(args);
        const payload = await apiRequest({
          method: "POST",
          path: "/v1/company/domain",
          bearer: bearerOf(),
          body: meta.body,
          query: { explain: meta.explain, schema: meta.schema },
          headers: routerHeaders(meta),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "company_hierarchy",
    {
      description:
        "POST /v1/company/hierarchy — decide corporate family (immediate / ultimate parent + capped subsidiaries). Outcomes: subsidiary | ultimate_parent | no_decision. Never standalone. speed is Wikidata only (0 credits); balance/accuracy use ZoomInfo BYOK. coverage is invalid_routing. Does not write SFDC.",
      inputSchema: DecideCompanyHierarchyInput,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async (args, extra) => {
      try {
        const meta = stripMeta(args);
        const payload = await apiRequest({
          method: "POST",
          path: "/v1/company/hierarchy",
          bearer: bearerOf(),
          body: meta.body,
          query: { explain: meta.explain, schema: meta.schema },
          headers: routerHeaders(meta),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "person_verify_employment",
    {
      description:
        "POST /v1/person/verify-employment — pre-flight whether to send to this person. Default path is balance (LeadMagic email validate + optional paid LinkedIn lookup). speed is LeadMagic validate only. accuracy adds AI Ark (BYOK). Findymail is a BYOK Layer-1 alternate only when routing.only selects it — never stacked after LeadMagic. Outcomes: high_confidence_send | low_confidence_send | low_confidence_block | high_confidence_block | no_decision. Does not write SFDC.",
      inputSchema: VerifyEmploymentInput,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async (args, extra) => {
      try {
        const meta = stripMeta(args);
        const payload = await apiRequest({
          method: "POST",
          path: "/v1/person/verify-employment",
          bearer: bearerOf(),
          body: meta.body,
          query: { explain: meta.explain, schema: meta.schema },
          headers: routerHeaders(meta),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_run",
    {
      description:
        "GET /v1/runs/{id} — fetch a recorded run. Completed runs match the capability POST envelope plus candidates. running/failed return a subset (decision/result/es_decision are null). 404 only for missing or another tenant's run.",
      inputSchema: GetRunInput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (args, extra) => {
      try {
        const payload = await apiRequest({
          method: "GET",
          path: encodePath("/v1/runs/{id}", { id: args.id }),
          bearer: bearerOf(),
          query: { explain: args.explain, schema: args.schema_version },
          headers: routerHeaders({
            explain: args.explain,
            schema: args.schema_version,
          }),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "put_credentials",
    {
      description:
        "PUT /v1/credentials/{provider} — upsert tenant Your Keys (ciphertext). ZoomInfo body is { clientId, clientSecret }. Other vendors use { apiKey }. Response never echoes the raw key. LeadMagic is the only house-key vendor; putting a LeadMagic key is optional. ZoomInfo, Findymail, Wiza, AI Ark, and BuiltWith are BYOK. Websearch cannot be stored. Confirm with the user first.",
      inputSchema: PutCredentialInput,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args, extra) => {
      try {
        const { provider, clientId, clientSecret, apiKey, api_key } = args;
        const body =
          provider === "zoominfo"
            ? { clientId, clientSecret }
            : { apiKey: apiKey ?? api_key };
        const payload = await apiRequest({
          method: "PUT",
          path: encodePath("/v1/credentials/{provider}", { provider }),
          bearer: bearerOf(),
          body,
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_credentials",
    {
      description:
        "DELETE /v1/credentials/{provider} — revoke tenant Your Keys for that vendor. Sets revoked_at on the live row. 404 when no live row. Response never includes the raw key. Confirm with the user first.",
      inputSchema: DeleteCredentialInput,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true, idempotentHint: true },
    },
    async (args, extra) => {
      try {
        const payload = await apiRequest({
          method: "DELETE",
          path: encodePath("/v1/credentials/{provider}", { provider: args.provider }),
          bearer: bearerOf(),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_subject",
    {
      description:
        "DELETE /v1/subjects/{subject_key} — tenant-scoped erasure (entities, identifiers, runs subtree, matching raw objects). Ledger is kept. Requires the erase key scope. Idempotent: unknown subjects return zeros. Confirm with the user first.",
      inputSchema: EraseSubjectInput,
      annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: true, idempotentHint: true },
    },
    async (args, extra) => {
      try {
        const payload = await apiRequest({
          method: "DELETE",
          path: encodePath("/v1/subjects/{subject_key}", {
            subject_key: args.subject_key,
          }),
          bearer: bearerOf(),
          signal: extra.signal,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  return server;
}

export function registeredToolNames(): ToolName[] {
  return LIVE_RESOURCE_ROUTES.map((route) => route.tool);
}
