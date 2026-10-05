import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny } from "zod";
import { LIVE_RESOURCE_ROUTES, type ToolName } from "./catalog.js";
import { PRODUCT_NAME, VERSION } from "./config.js";
import {
  KingMinosApiError,
  remediationFor,
  toolErrorResult,
} from "./errors.js";
import {
  type ApiMethod,
  apiRequest,
  okText,
  requireBearer,
} from "./kingminos-client.js";
import {
  DecideCompanyDomainInput,
  DecideCompanyHierarchyInput,
  DeleteCredentialInput,
  EmptyInput,
  EraseSubjectInput,
  GetRunInput,
  PERCENT_ENCODED,
  PutCredentialInput,
  ResolveCompanyInput,
  VerifyEmploymentInput,
  stripMeta,
} from "./schemas.js";

export interface ToolContext {
  bearer?: string;
  apiBaseUrl?: string;
}

export interface BuiltRequest {
  pathParams?: Record<string, string>;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

interface ToolSpec {
  description: string;
  inputSchema: Record<string, ZodTypeAny>;
  annotations: ToolAnnotations;
  buildRequest: (args: Record<string, unknown>) => BuiltRequest;
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

export function encodePath(
  template: string,
  params: Record<string, string> = {},
): string {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  return path;
}

function asRecord(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null
    ? (args as Record<string, unknown>)
    : {};
}

function stringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function capabilityRequest(args: Record<string, unknown>): BuiltRequest {
  const meta = stripMeta(args);
  return {
    body: meta.body,
    query: { explain: meta.explain, schema: meta.schema },
    headers: routerHeaders(meta),
  };
}

function badRequest(message: string): KingMinosApiError {
  return new KingMinosApiError({
    code: "bad_request",
    message,
    remediation: remediationFor("bad_request"),
    retryable: false,
  });
}

export function credentialPutBody(
  args: Record<string, unknown>,
): Record<string, string> {
  const provider = stringArg(args, "provider");
  if (!provider) {
    throw badRequest("Missing provider.");
  }
  const clientId = stringArg(args, "clientId");
  const clientSecret = stringArg(args, "clientSecret");
  const apiKey = stringArg(args, "apiKey") ?? stringArg(args, "api_key");

  if (provider === "zoominfo") {
    if (apiKey) {
      throw badRequest(
        "zoominfo does not accept apiKey; send clientId and clientSecret.",
      );
    }
    const missing: string[] = [];
    if (!clientId) missing.push("clientId");
    if (!clientSecret) missing.push("clientSecret");
    if (missing.length > 0) {
      throw badRequest(`zoominfo is missing ${missing.join(" and ")}.`);
    }
    return {
      clientId: clientId as string,
      clientSecret: clientSecret as string,
    };
  }

  if (!apiKey) {
    throw badRequest(`${provider} is missing apiKey.`);
  }
  return { apiKey };
}

export function rawSubjectKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("subject_key is required.");
  }
  const key = value.trim();
  if (PERCENT_ENCODED.test(key)) {
    throw badRequest(
      "subject_key must be the raw unencoded key (e.g. email:a@b.com), not percent-encoded.",
    );
  }
  return key;
}

const PUT_CREDENTIALS_WARNING =
  "The vendor key will be visible in this conversation; prefer the web app at https://app.kingminos.com/app/keys/.";

const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  get_providers: {
    description:
      "GET /v1/providers — static provider registry plus configured flags, billing_mode, and credit estimates. Does not start a run. LeadMagic is the only house-key vendor; other paid vendors are BYOK.",
    inputSchema: EmptyInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: () => ({}),
  },
  get_capabilities: {
    description:
      "GET /v1/capabilities — catalog for company.resolve, person.verify_employment, company.domain, and company.hierarchy (inputs, outcomes, hops, default routing). Call this before the first resolve. Does not start a run.",
    inputSchema: EmptyInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: () => ({}),
  },
  company_resolve: {
    description:
      "POST /v1/company/resolve — resolve a company from email, domain, or website. Spends credits and writes a run unless dry_run is true (API default is false). Name-only input is no_decision / no_domain. Default path is auto. A LeadMagic-only or websearch-only hit is resolved_without_primary_id — do not stamp a ZoomInfo id unless es_decision is hit and result.zoominfo_company_id is present. ZoomInfo / Findymail / Wiza / AI Ark need BYOK; LeadMagic is house-keyed. Does not write SFDC.",
    inputSchema: ResolveCompanyInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  company_domain: {
    description:
      "POST /v1/company/domain — decide what the CRM domain field should say and whether it is safe to write. Outcomes: verified | corrected | discovered | rejected | unverified | no_decision. Write-safe stamps live on result.account_primary_domain + additional_domains. coverage needs BuiltWith BYOK. Spends credits unless dry_run is true. Does not write SFDC.",
    inputSchema: DecideCompanyDomainInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  company_hierarchy: {
    description:
      "POST /v1/company/hierarchy — decide corporate family (immediate / ultimate parent + capped subsidiaries). Outcomes: subsidiary | ultimate_parent | no_decision. Never standalone. speed is Wikidata only (0 credits); balance/accuracy use ZoomInfo BYOK. coverage is invalid_routing. Spends credits unless dry_run is true. Does not write SFDC.",
    inputSchema: DecideCompanyHierarchyInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  person_verify_employment: {
    description:
      "POST /v1/person/verify-employment — pre-flight whether to send to this person. Default path is balance (LeadMagic email validate + optional paid LinkedIn lookup). speed is LeadMagic validate only. accuracy adds AI Ark (BYOK). Findymail is a BYOK Layer-1 alternate only when routing.only selects it — never stacked after LeadMagic. Outcomes: high_confidence_send | low_confidence_send | low_confidence_block | high_confidence_block | no_decision. Spends credits unless dry_run is true. Does not write SFDC.",
    inputSchema: VerifyEmploymentInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  get_run: {
    description:
      "GET /v1/runs/{id} — fetch a recorded run. Completed runs match the capability POST envelope plus candidates. running/failed return a subset (decision/result/es_decision are null). 404 only for missing or another tenant's run.",
    inputSchema: GetRunInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { id: String(args.id ?? "") },
      query: {
        explain: stringArg(args, "explain"),
        schema: stringArg(args, "schema_version"),
      },
      headers: routerHeaders({
        explain: stringArg(args, "explain"),
        schema: stringArg(args, "schema_version"),
      }),
    }),
  },
  list_credentials: {
    description:
      "GET /v1/credentials — masked Your Keys catalog (provider, status, mask). Never returns raw keys. A tenant Bearer lists tenant_provider_credentials. LeadMagic without a stored row is managed (house key). Other vendors are unset until stored.",
    inputSchema: EmptyInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: () => ({}),
  },
  put_credentials: {
    description: [
      "PUT /v1/credentials/{provider} — upsert tenant Your Keys (ciphertext).",
      "ZoomInfo body is { clientId, clientSecret }. Other vendors use { apiKey }.",
      "Response never echoes the raw key. LeadMagic is the only house-key vendor; putting a LeadMagic key is optional.",
      "ZoomInfo, Findymail, Wiza, AI Ark, and BuiltWith are BYOK. Websearch cannot be stored.",
      PUT_CREDENTIALS_WARNING,
      "Confirm with the user first.",
    ].join(" "),
    inputSchema: PutCredentialInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { provider: String(args.provider ?? "") },
      body: credentialPutBody(args),
    }),
  },
  delete_credentials: {
    description:
      "DELETE /v1/credentials/{provider} — revoke tenant Your Keys for that vendor. Sets revoked_at on the live row. 404 when no live row. Response never includes the raw key. Confirm with the user first.",
    inputSchema: DeleteCredentialInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: true,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { provider: String(args.provider ?? "") },
    }),
  },
  delete_subject: {
    description:
      "DELETE /v1/subjects/{subject_key} — tenant-scoped erasure (entities, identifiers, runs subtree, matching raw objects). Ledger is kept. Requires the erase key scope. Idempotent: unknown subjects return zeros. Send the raw unencoded subject key. Confirm with the user first.",
    inputSchema: EraseSubjectInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: true,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { subject_key: rawSubjectKey(args.subject_key) },
    }),
  },
};

function asApiMethod(method: string): ApiMethod {
  if (
    method === "GET" ||
    method === "POST" ||
    method === "PUT" ||
    method === "DELETE"
  ) {
    return method;
  }
  throw new Error(`Unsupported tool method: ${method}`);
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
        PUT_CREDENTIALS_WARNING,
        "Say SFDC, never SF. Branch automations on answer.outcome / es_decision — business misses stay HTTP 200.",
      ].join(" "),
    },
  );

  const bearerOf = (): string => requireBearer(context.bearer);
  const requestBaseUrl = context.apiBaseUrl;

  for (const route of LIVE_RESOURCE_ROUTES) {
    const spec = TOOL_SPECS[route.tool];
    const handler = async (
      args: Record<string, unknown>,
      extra: { signal?: AbortSignal },
    ) => {
      try {
        const built = spec.buildRequest(asRecord(args));
        const payload = await apiRequest({
          method: asApiMethod(route.method),
          path: encodePath(route.path, built.pathParams),
          bearer: bearerOf(),
          body: built.body,
          query: built.query,
          headers: built.headers,
          signal: extra.signal,
          baseUrl: requestBaseUrl,
        });
        return okText(payload);
      } catch (error) {
        return toolErrorResult(error);
      }
    };
    server.registerTool(
      route.tool,
      {
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: spec.annotations,
      },
      handler,
    );
  }

  return server;
}
