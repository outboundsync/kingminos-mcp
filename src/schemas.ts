import { z } from "zod";

export const ProviderName = z
  .enum([
    "zoominfo",
    "leadmagic",
    "websearch",
    "findymail",
    "wiza",
    "aiark",
    "dns",
    "site_probe",
    "wikidata",
    "gleif",
    "rdap",
    "builtwith",
  ])
  .describe(
    "Stable provider id. LeadMagic is the only house-key vendor. ZoomInfo, Findymail, Wiza, AI Ark, and BuiltWith are BYOK. Websearch is house-only.",
  );

export const CredentialProvider = z
  .enum(["zoominfo", "leadmagic", "findymail", "wiza", "aiark", "builtwith"])
  .describe(
    "Vendor for tenant Your Keys. Websearch is rejected (house-only). LeadMagic is house-keyed; storing a LeadMagic key is an optional override.",
  );

export const ExplainMode = z
  .enum(["default", "full", "minimal"])
  .describe(
    "Response verbosity. Omit or default is the clean v2 envelope (no trace). full adds trace. minimal aliases default (SFDC Flow).",
  );

export const SchemaPin = z
  .enum(["2"])
  .describe("Pin the KingMinos envelope to schema_version 2.");

const IdentifierInput = z.object({
  provider: z.string().optional(),
  id_type: z.string().optional().describe("Request alias for idType"),
  idType: z.string().optional().describe("Request alias for id_type"),
  value: z.string().optional(),
});

const MaxProviderCredits = z.union([
  z.number(),
  z
    .object({
      "company.resolve": z.number().optional(),
      "person.verify_employment": z.number().optional(),
      "company.domain": z.number().optional(),
      "company.hierarchy": z.number().optional(),
    })
    .strict(),
]);

export const RoutingRequest = z
  .object({
    path: z
      .enum(["speed", "balance", "value", "auto", "accuracy", "coverage", "fast"])
      .optional()
      .describe(
        "Product path. company.resolve omit = auto (value|auto|accuracy|coverage). person.verify_employment omit = balance (speed|balance|accuracy only).",
      ),
    preset: z
      .enum([
        "speed",
        "balance",
        "value",
        "auto",
        "accuracy",
        "coverage",
        "name_only",
        "zi_stamp",
        "fast",
      ])
      .optional()
      .describe("Back-compat alias of path plus zi_stamp (optional ZoomInfo-first). Prefer path."),
    strategy: z.enum(["waterfall"]).optional(),
    order: z.array(ProviderName).optional(),
    allow_fallbacks: z.boolean().optional(),
    max_provider_credits: MaxProviderCredits.optional(),
    free_first: z.boolean().optional(),
    only: z.array(ProviderName).optional(),
    ignore: z.array(ProviderName).optional(),
    allow_paid_linkedin_lookup: z
      .boolean()
      .optional()
      .describe(
        "LeadMagic email→profile when no LinkedIn URL is known. Default-on for balance/accuracy. Speed stays off.",
      ),
  })
  .strict();

export const CompanyDomainRoutingRequest = z
  .object({
    path: z
      .enum([
        "speed",
        "balance",
        "accuracy",
        "coverage",
        "value",
        "auto",
        "fast",
        "name_only",
      ])
      .optional()
      .describe(
        "company.domain path. Omit = balance. coverage is accuracy + BuiltWith (BYOK). Legacy: fast/value/name_only → speed, auto → balance.",
      ),
    preset: z
      .enum([
        "speed",
        "balance",
        "accuracy",
        "coverage",
        "value",
        "auto",
        "name_only",
        "zi_stamp",
        "fast",
      ])
      .optional(),
    strategy: z.enum(["waterfall"]).optional(),
    order: z.array(ProviderName).optional(),
    allow_fallbacks: z.boolean().optional(),
    max_provider_credits: MaxProviderCredits.optional(),
    free_first: z.boolean().optional(),
    only: z.array(ProviderName).optional(),
    ignore: z.array(ProviderName).optional(),
    allow_paid_linkedin_lookup: z.boolean().optional(),
  })
  .strict();

export const ComplianceRequest = z
  .object({
    soc2: z
      .boolean()
      .optional()
      .describe("When true, every considered hop must have a house SOC 2 attestation."),
    data: z
      .boolean()
      .optional()
      .describe(
        "When true, every considered hop must publish a customer DPA and/or a thorough public privacy policy.",
      ),
  })
  .strict();

const CommonRunOptions = {
  dry_run: z
    .boolean()
    .optional()
    .describe("When true, run as a dry-run. Default false on the API."),
  external_ref: z
    .string()
    .optional()
    .describe("Client correlation key. Round-trips on the run response."),
  compliance: ComplianceRequest.optional(),
  schema_version: SchemaPin.optional(),
  explain: ExplainMode.optional().describe(
    "Maps to X-Router-Explain / ?explain=. Omit for the clean envelope.",
  ),
  idempotency_key: z
    .string()
    .optional()
    .describe("Sent as Idempotency-Key. Reusing a spent key replays the prior run."),
};

export const ResolveCompanyInput = {
  email: z
    .string()
    .optional()
    .describe("Typical caller input. Domain is derived after @ when needed."),
  domain: z
    .string()
    .optional()
    .describe("Also accepts email-shaped strings (domain extracted after @)."),
  website: z.string().optional(),
  name: z
    .string()
    .optional()
    .describe(
      "Accepted on the request. Name-only (no domain/email/website) is no_decision / no_domain and does not search.",
    ),
  routing: RoutingRequest.optional(),
  ...CommonRunOptions,
};

export const DecideCompanyDomainInput = {
  domain: z.string().optional(),
  website: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional().describe("Optional company name. Alias company_name is accepted."),
  company_name: z.string().optional().describe("Alias of name."),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  phone: z.string().optional(),
  linkedin_url: z
    .string()
    .optional()
    .describe("LinkedIn company page URL (linkedin.com/company/...). Person /in/ URLs are rejected."),
  family_policy: z
    .enum(["collapse_brand", "separate_regional"])
    .optional()
    .describe("How alias / regional / family facts map to CRM shape. Omit = collapse_brand."),
  routing: CompanyDomainRoutingRequest.optional(),
  path: z
    .enum(["speed", "balance", "accuracy", "coverage", "value", "auto", "fast", "name_only"])
    .optional()
    .describe("Flattened alias of routing.path. Nested routing.path wins when both are sent."),
  preset: z
    .enum([
      "speed",
      "balance",
      "accuracy",
      "coverage",
      "value",
      "auto",
      "name_only",
      "zi_stamp",
      "fast",
    ])
    .optional()
    .describe("Flattened alias of routing.preset. Nested wins when both are sent."),
  skip_cache: z
    .boolean()
    .optional()
    .describe("Skip the short-TTL company.domain cache read. Does not skip Idempotency-Key replay."),
  cache_bypass: z
    .boolean()
    .optional()
    .describe("When true, send X-Router-Cache: bypass (same as skip_cache)."),
  ...CommonRunOptions,
};

export const DecideCompanyHierarchyInput = {
  domain: z.string().optional(),
  website: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  country: z.string().optional(),
  routing: CompanyDomainRoutingRequest.optional(),
  path: z
    .enum(["speed", "balance", "accuracy", "value", "auto", "fast"])
    .optional()
    .describe("Flattened alias of routing.path. Nested wins when both are sent. coverage is invalid."),
  preset: z
    .enum(["speed", "balance", "accuracy", "value", "auto", "name_only", "zi_stamp", "fast"])
    .optional(),
  ...CommonRunOptions,
};

export const VerifyEmploymentInput = {
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  linkedin_url: z.string().optional(),
  person: z
    .object({
      email: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      linkedin_url: z.string().optional(),
    })
    .optional(),
  expected_company: z
    .object({
      domain: z.string().optional(),
      website: z.string().optional(),
      name: z.string().optional(),
      identifiers: z.array(IdentifierInput).optional(),
    })
    .optional(),
  routing: RoutingRequest.optional(),
  ...CommonRunOptions,
};

export const GetRunInput = {
  id: z.string().describe("Run id returned by a capability POST."),
  explain: ExplainMode.optional(),
  schema_version: SchemaPin.optional(),
};

export const PutCredentialInput = {
  provider: CredentialProvider,
  clientId: z
    .string()
    .optional()
    .describe("ZoomInfo OAuth client id. Required with clientSecret for zoominfo."),
  clientSecret: z
    .string()
    .optional()
    .describe("ZoomInfo OAuth client secret. Required with clientId for zoominfo."),
  apiKey: z
    .string()
    .optional()
    .describe("API key for leadmagic, findymail, wiza, aiark, or builtwith. Alias: api_key."),
  api_key: z.string().optional().describe("Alias of apiKey."),
};

export const DeleteCredentialInput = {
  provider: CredentialProvider,
};

export const EraseSubjectInput = {
  subject_key: z
    .string()
    .describe(
      "Stable subject key (URL-encoded). Company: registrable domain. Person: email:<addr> or li:<slug>. Requires the erase key scope.",
    ),
};

export const EmptyInput = {};

export function stripMeta<T extends Record<string, unknown>>(
  args: T,
): {
  body: Record<string, unknown>;
  explain?: string;
  schema?: string;
  idempotencyKey?: string;
  cacheBypass?: boolean;
} {
  const {
    explain,
    idempotency_key: idempotencyKey,
    cache_bypass: cacheBypass,
    ...rest
  } = args;
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      body[key] = value;
    }
  }
  return {
    body,
    explain: typeof explain === "string" ? explain : undefined,
    schema: typeof body.schema_version === "string" ? body.schema_version : undefined,
    idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : undefined,
    cacheBypass: cacheBypass === true || body.skip_cache === true,
  };
}
