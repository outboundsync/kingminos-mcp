import { z } from "zod";

/** routing.only / order / ignore. Keep in lockstep with inventory/openapi-surfaces.json providers[]. */
export const PROVIDER_NAME_VALUES = [
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
  "prospeo",
  "apollo",
  "companyurlfinder",
  "peopledatalabs",
  "hginsights",
  "brandfetch",
  "enrichcrm",
  "favicon",
  "lemlist",
] as const;

/** put_credentials / delete_credentials. Keep in lockstep with inventory credentialProviders[]. */
export const CREDENTIAL_PROVIDER_VALUES = [
  "zoominfo",
  "leadmagic",
  "findymail",
  "wiza",
  "aiark",
  "builtwith",
  "prospeo",
  "apollo",
  "companyurlfinder",
  "peopledatalabs",
  "hginsights",
  "brandfetch",
  "enrichcrm",
  "lemlist",
  "snovio",
  "cognism",
  "lusha",
  "starbridge",
  "clay",
  "databar",
  "quickenrich",
  "getleads",
  "blitzapi",
] as const;

/** put_credentials OAuth vendors ({ clientId, clientSecret }). Keep in lockstep with application OAUTH_PROVIDER_NAMES. */
export const OAUTH_CREDENTIAL_PROVIDER_VALUES = ["zoominfo", "snovio"] as const;

export const ProviderName = z
  .enum(PROVIDER_NAME_VALUES)
  .describe(
    "Stable provider id. LeadMagic, Wiza, Findymail, and AI Ark are the approved house-key vendors. ZoomInfo, BuiltWith, Prospeo, Apollo, Company URL Finder, People Data Labs, HG Insights, Brandfetch, Enrich-CRM, and Lemlist are BYOK. Websearch is house-only.",
  );

export const CredentialProvider = z
  .enum(CREDENTIAL_PROVIDER_VALUES)
  .describe(
    "Vendor for tenant Your Keys. Websearch is rejected (house-only). LeadMagic, Wiza, Findymail, and AI Ark are house-keyed; storing those keys is an optional override.",
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
      "company.b2b_social": z.number().optional(),
      "company.icon": z.number().optional(),
      "company.description": z.number().optional(),
      "person.language": z.number().optional(),
    })
    .strict(),
]);

export const RoutingRequest = z
  .object({
    path: z
      .enum([
        "speed",
        "balance",
        "value",
        "auto",
        "accuracy",
        "coverage",
        "fast",
      ])
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
      .describe(
        "Back-compat alias of path plus zi_stamp (optional ZoomInfo-first). Prefer path.",
      ),
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
      .describe(
        "When true, every considered hop must have a house SOC 2 attestation.",
      ),
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
    .describe(
      "When true, skip credit spend and run persistence. API default is false — calls are not free unless you set this.",
    ),
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
    .describe(
      "Sent as Idempotency-Key. Reusing a spent key replays the prior run.",
    ),
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
  name: z
    .string()
    .optional()
    .describe("Optional company name. Alias company_name is accepted."),
  company_name: z.string().optional().describe("Alias of name."),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  phone: z.string().optional(),
  linkedin_url: z
    .string()
    .optional()
    .describe(
      "LinkedIn company page URL (linkedin.com/company/...). Person /in/ URLs are rejected.",
    ),
  family_policy: z
    .enum(["collapse_brand", "separate_regional"])
    .optional()
    .describe(
      "How alias / regional / family facts map to CRM shape. Omit = collapse_brand.",
    ),
  routing: CompanyDomainRoutingRequest.optional(),
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
      "Flattened alias of routing.path. Nested routing.path wins when both are sent.",
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
    .optional()
    .describe(
      "Flattened alias of routing.preset. Nested wins when both are sent.",
    ),
  skip_cache: z
    .boolean()
    .optional()
    .describe(
      "Skip the short-TTL company.domain cache read. Does not skip Idempotency-Key replay.",
    ),
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
    .describe(
      "Flattened alias of routing.path. Nested wins when both are sent. coverage is invalid.",
    ),
  preset: z
    .enum([
      "speed",
      "balance",
      "accuracy",
      "value",
      "auto",
      "name_only",
      "zi_stamp",
      "fast",
    ])
    .optional(),
  ...CommonRunOptions,
};

export const DecideCompanyB2bSocialInput = {
  name: z
    .string()
    .optional()
    .describe(
      "Optional unit/brand corroboration. Name-only without domain/website/email is 400.",
    ),
  domain: z
    .string()
    .optional()
    .describe(
      "Required subject (or website/email that hygiene-normalize to the same registrable).",
    ),
  website: z.string().optional(),
  email: z.string().optional(),
  linkedin_url: z
    .string()
    .optional()
    .describe(
      "Optional company-page hint. Must be https://www.linkedin.com/company/{slug}. Person /in/ is 400.",
    ),
  routing: CompanyDomainRoutingRequest.optional(),
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
      "Flattened alias of routing.path. Omit = balance. Nested routing.path wins when both are sent.",
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
    .optional()
    .describe(
      "Flattened alias of routing.preset. Nested wins when both are sent.",
    ),
  ...CommonRunOptions,
};

export const DecideCompanyIconInput = {
  domain: z
    .string()
    .describe(
      "Registrable domain to fetch, normalize, and host an icon for. Required.",
    ),
  name: z
    .string()
    .optional()
    .describe("Optional company-name hint for corroboration."),
  ...CommonRunOptions,
};

export const DecideCompanyDescriptionInput = {
  name: z
    .string()
    .optional()
    .describe(
      "Optional unit/brand corroboration. Name-only without domain/website/email is 400.",
    ),
  domain: z
    .string()
    .optional()
    .describe(
      "Required subject (or website/email that hygiene-normalize to the same registrable).",
    ),
  website: z.string().optional(),
  email: z.string().optional(),
  routing: CompanyDomainRoutingRequest.optional(),
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
      "Flattened alias of routing.path. Always pass explicitly; omit runs balance at cap 6; path balance is cap 2. Nested routing.path wins when both are sent. company.description paths (not aliases): speed = homepage meta/og then AI Ark (cap 1) | balance = Jev-ranked homepage extracts + meta/og + AI Ark, optional rewrite (cap 2 when sent explicitly) | accuracy (cap 3) = xAI third-person compose from homepage evidence | coverage (cap 6) = accuracy compose plus off-homepage Serper / ZoomInfo BYOK evidence.",
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
    .optional()
    .describe(
      "Flattened alias of routing.preset. Nested wins when both are sent.",
    ),
  max_chars: z
    .number()
    .int()
    .min(80)
    .max(500)
    .optional()
    .describe(
      "Max description length (80–500, API default 300). Trims at a sentence boundary; never mid-word.",
    ),
  skip_cache: z
    .boolean()
    .optional()
    .describe(
      "Skip the 30-day company.description result-cache read and re-run the ladder (still writes). Same as cache_bypass (X-Router-Cache: bypass). Does not skip Idempotency-Key replay.",
    ),
  cache_bypass: z
    .boolean()
    .optional()
    .describe(
      "When true, send X-Router-Cache: bypass (same as skip_cache; other header values are 400). Does not skip Idempotency-Key replay.",
    ),
  ...CommonRunOptions,
};

const PersonLanguagePath = z.enum(["speed", "balance", "accuracy"]);

export const PersonLanguageInput = {
  email: z
    .string()
    .optional()
    .describe("Work email. One of email / linkedin_url is required."),
  linkedin_url: z
    .string()
    .optional()
    .describe(
      "LinkedIn profile URL or slug. One of email / linkedin_url is required; an unparseable URL is 400 invalid_linkedin_url.",
    ),
  first_name: z
    .string()
    .optional()
    .describe(
      "Match-only: rejects a profile that belongs to someone else (person_mismatch). A name never infers a language.",
    ),
  last_name: z.string().optional().describe("Match-only (see first_name)."),
  person: z
    .object({
      email: z.string().optional(),
      linkedin_url: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    })
    .optional()
    .describe("Nested alternative to the top-level person fields."),
  routing: z
    .object({
      path: PersonLanguagePath.optional().describe(
        "speed (cap 1) | balance (default, cap 3) | accuracy (cap 4). coverage is 400 invalid_routing.",
      ),
      preset: PersonLanguagePath.optional().describe("Alias of path."),
    })
    .optional()
    .describe(
      "Only path (or preset) is read; other routing fields are ignored.",
    ),
  skip_cache: z
    .boolean()
    .optional()
    .describe(
      "Skip the 30-day cache read (still writes). Same as cache_bypass (X-Router-Cache: bypass).",
    ),
  cache_bypass: z
    .boolean()
    .optional()
    .describe("When true, send X-Router-Cache: bypass (same as skip_cache)."),
  ...CommonRunOptions,
};

/** person.phone `format` (API 2026-10-13): which format fills `number`. */
export const PHONE_FORMAT_VALUES = [
  "e164",
  "international",
  "national",
  "digits",
  "digits_national",
] as const;

export const PHONE_TYPE_VALUES = [
  "mobile",
  "landline",
  "other",
  "unknown",
] as const;

export const PersonPhoneInput = {
  email: z
    .string()
    .optional()
    .describe("Work email. One of email / linkedin_url is required."),
  linkedin_url: z
    .string()
    .optional()
    .describe(
      "LinkedIn profile URL or slug. One of email / linkedin_url is required; an unparseable URL is 400 invalid_linkedin_url.",
    ),
  first_name: z
    .string()
    .optional()
    .describe(
      "Match-only: rejects a profile that belongs to someone else (person_mismatch). A name never infers anything.",
    ),
  last_name: z.string().optional().describe("Match-only (see first_name)."),
  person: z
    .object({
      email: z.string().optional(),
      linkedin_url: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    })
    .optional()
    .describe("Nested alternative to the top-level person fields."),
  phone_types: z
    .array(z.enum(PHONE_TYPE_VALUES))
    .optional()
    .describe(
      "Answer filter: mobile | landline | other | unknown. Omit = any type. A number outside the filter is a miss for this request. Part of the cache key.",
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Cap on the ranked result.phones list (1–10, API default 3)."),
  format: z
    .enum(PHONE_FORMAT_VALUES)
    .optional()
    .describe(
      "Which format fills `number` on best_phone and phones[]: e164 (default) | international | national | digits | digits_national. Every phone also carries e164 and all five under `formats`. Presentation only — not part of the cache key.",
    ),
  routing: z
    .object({
      only: z
        .array(ProviderName)
        .optional()
        .describe(
          "Vendor isolation: run only these providers. A known provider with no phone hop empties the ladder (not_configured).",
        ),
      ignore: z
        .array(ProviderName)
        .optional()
        .describe("Skip these providers."),
    })
    .optional()
    .describe(
      "Only routing.only / routing.ignore are honored (part of the cache key). path / preset / order are ignored — the ladder is locked.",
    ),
  skip_cache: z
    .boolean()
    .optional()
    .describe(
      "Skip the 30-day cache read (still writes). Same as cache_bypass (X-Router-Cache: bypass).",
    ),
  cache_bypass: z
    .boolean()
    .optional()
    .describe("When true, send X-Router-Cache: bypass (same as skip_cache)."),
  ...CommonRunOptions,
};

export const TITLE_FIELD_VALUES = ["title", "seniority", "function"] as const;

export const PersonTitlePath = z.enum([
  "speed",
  "balance",
  "accuracy",
  "coverage",
]);

export const PersonTitleInput = {
  email: z
    .string()
    .optional()
    .describe("Work email. One of email / linkedin_url is required."),
  linkedin_url: z
    .string()
    .optional()
    .describe(
      "LinkedIn profile URL or slug. One of email / linkedin_url is required; an unparseable URL is 400 invalid_linkedin_url.",
    ),
  first_name: z
    .string()
    .optional()
    .describe(
      "Match-only: rejects a profile that belongs to someone else (person_mismatch). A name never infers anything.",
    ),
  last_name: z.string().optional().describe("Match-only (see first_name)."),
  company_domain: z
    .string()
    .optional()
    .describe(
      "Match-only current employer. A title at a different employer is never a hit (employer_mismatch). Never steers routing.",
    ),
  person: z
    .object({
      email: z.string().optional(),
      linkedin_url: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      company_domain: z.string().optional(),
    })
    .optional()
    .describe("Nested alternative to the top-level person fields."),
  fields: z
    .array(z.enum(TITLE_FIELD_VALUES))
    .optional()
    .describe(
      "Which answers you want: title | seniority | function. Omit = all three. The ladder walks until every requested field is answered; part of the cache key.",
    ),
  routing: z
    .object({
      path: PersonTitlePath.optional().describe(
        "speed (1 credit on a hit) | balance (default, 2) | accuracy (3) | coverage (5). 0 on a miss or partial.",
      ),
      only: z
        .array(ProviderName)
        .optional()
        .describe(
          "Vendor isolation: run only these providers on the path's stack.",
        ),
      ignore: z
        .array(ProviderName)
        .optional()
        .describe("Skip these providers."),
      max_provider_credits: z
        .number()
        .min(0)
        .optional()
        .describe(
          "Below the path price the call is a 0-credit max_credits_reached noop.",
        ),
    })
    .optional()
    .describe(
      "path picks the ladder; only / ignore isolate vendors (part of the cache key).",
    ),
  skip_cache: z
    .boolean()
    .optional()
    .describe(
      "Skip the 30-day cache read (still writes). Same as cache_bypass (X-Router-Cache: bypass).",
    ),
  cache_bypass: z
    .boolean()
    .optional()
    .describe("When true, send X-Router-Cache: bypass (same as skip_cache)."),
  ...CommonRunOptions,
};

export const MinConfidence = z
  .enum(["high", "medium", "low"])
  .describe(
    "Optional write floor; overrides the path default. A below-floor answer is withheld (blank, confidence kept) and bills 0.",
  );

export const PersonB2bSocialPath = z.enum(["speed", "balance", "accuracy"]);

export const PersonB2bSocialInput = {
  email: z
    .string()
    .optional()
    .describe(
      "Email address: the one discovery key. Required here or under person.email (else 400 email_required).",
    ),
  linkedin_url: z
    .string()
    .optional()
    .describe(
      "Match-only: a resolved profile with another slug is rejected (person_mismatch). Never a discovery key; a company page is 400 invalid_linkedin_url.",
    ),
  first_name: z
    .string()
    .optional()
    .describe(
      "Match-only: rejects a profile that belongs to someone else (person_mismatch). A name never discovers or scores anything.",
    ),
  last_name: z.string().optional().describe("Match-only (see first_name)."),
  person: z
    .object({
      email: z.string().optional(),
      linkedin_url: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
    })
    .optional()
    .describe("Nested alternative to the top-level person fields."),
  min_confidence: MinConfidence.optional(),
  routing: z
    .object({
      path: PersonB2bSocialPath.optional().describe(
        "speed (2 credits on a hit) | balance (default, 3) | accuracy (5). No coverage tier. 0 on a miss, mismatch or below-floor withhold.",
      ),
      only: z
        .array(ProviderName)
        .optional()
        .describe(
          "Vendor isolation: run only these providers on the path's stack.",
        ),
      ignore: z
        .array(ProviderName)
        .optional()
        .describe("Skip these providers."),
      max_provider_credits: z
        .number()
        .min(0)
        .optional()
        .describe(
          "Below the path price the call is a 0-credit max_credits_reached noop.",
        ),
    })
    .optional()
    .describe(
      "path picks the ladder; only / ignore isolate vendors (part of the cache key).",
    ),
  skip_cache: z
    .boolean()
    .optional()
    .describe(
      "Skip the 30-day cache read (still writes). Same as cache_bypass (X-Router-Cache: bypass).",
    ),
  cache_bypass: z
    .boolean()
    .optional()
    .describe("When true, send X-Router-Cache: bypass (same as skip_cache)."),
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
    .describe(
      "OAuth client id. Required with clientSecret for zoominfo and snovio.",
    ),
  clientSecret: z
    .string()
    .optional()
    .describe(
      "OAuth client secret. Required with clientId for zoominfo and snovio.",
    ),
  apiKey: z
    .string()
    .optional()
    .describe(
      "API key for leadmagic, findymail, wiza, aiark, builtwith, prospeo, apollo, companyurlfinder, peopledatalabs, hginsights, brandfetch, enrichcrm, lemlist, cognism, lusha, starbridge, clay, databar, quickenrich, getleads, or blitzapi. Alias: api_key. Do not send for zoominfo or snovio.",
    ),
  api_key: z
    .string()
    .optional()
    .describe("Alias of apiKey. Do not send for zoominfo or snovio."),
};

export const DeleteCredentialInput = {
  provider: CredentialProvider,
};

export const PERCENT_ENCODED = /%[0-9A-Fa-f]{2}/;

export const EraseSubjectInput = {
  subject_key: z
    .string()
    .describe(
      "Raw, unencoded subject key (e.g. email:a@b.com, li:jane-doe, acme.com). The server URL-encodes it. Do not send percent-encoded values. Requires the erase key scope.",
    ),
};

export const EmptyInput = {};

export const ACTIVE_WEBHOOK_EVENT_VALUES = [
  "run.failed",
  "run.recovered",
] as const;
export const WEBHOOK_EVENT_TYPE_VALUES = [
  ...ACTIVE_WEBHOOK_EVENT_VALUES,
  "test.ping",
] as const;
export const WEBHOOK_DELIVERY_STATUS_VALUES = [
  "pending",
  "succeeded",
  "failed",
  "dead",
] as const;

export const WebhookIdInput = {
  id: z
    .string()
    .describe(
      "Webhook endpoint id (kmwhk_…) as returned by create_webhook or list_webhooks.",
    ),
};

export const CreateWebhookInput = {
  url: z
    .string()
    .url()
    .describe(
      "HTTPS endpoint URL. Private, loopback, and link-local targets (including DNS-resolved) are rejected; the answer is re-checked per delivery attempt.",
    ),
  description: z.string().max(300).optional().describe("Optional human label."),
  enabled_events: z
    .array(z.enum(ACTIVE_WEBHOOK_EVENT_VALUES))
    .optional()
    .describe(
      "Active event types to receive. Empty or omitted = all active types (run.failed, run.recovered). Reserved names are rejected.",
    ),
};

export const PatchWebhookInput = {
  id: WebhookIdInput.id.describe("Webhook endpoint id (kmwhk_…)."),
  url: z
    .string()
    .url()
    .optional()
    .describe("New HTTPS endpoint URL (revalidated)."),
  description: z.string().max(300).nullable().optional(),
  enabled_events: z.array(z.enum(ACTIVE_WEBHOOK_EVENT_VALUES)).optional(),
  is_active: z
    .boolean()
    .optional()
    .describe("Re-enabling after an auto-disable clears the failure streak."),
};

export const ListWebhookDeliveriesInput = {
  id: WebhookIdInput.id.describe("Webhook endpoint id (kmwhk_…)."),
  status: z.enum(WEBHOOK_DELIVERY_STATUS_VALUES).optional(),
  limit: z.number().int().optional().describe("Default 25, max 100."),
};

export const ReplayDeliveryInput = {
  id: WebhookIdInput.id.describe("Webhook endpoint id (kmwhk_…)."),
  delivery_id: z
    .string()
    .describe("Delivery id (kmwhd_…) from list_webhook_deliveries."),
};

export const ListEventsInput = {
  type: z.enum(WEBHOOK_EVENT_TYPE_VALUES).optional(),
  delivered: z
    .boolean()
    .optional()
    .describe(
      "true = at least one successful delivery; false = no successful delivery yet (still retrying, dead, or no endpoint subscribed).",
    ),
  limit: z.number().int().optional().describe("Default 50, max 200."),
  cursor: z
    .string()
    .optional()
    .describe("Keyset cursor from a previous next_cursor."),
};

export const FEEDBACK_CATEGORY_VALUES = [
  "api_schema",
  "mcp",
  "data_quality",
  "provider_request",
  "endpoint_request",
  "workflow_friction",
  "product_idea",
] as const;

export const FEEDBACK_CAPABILITY_VALUES = [
  "company.resolve",
  "person.verify_employment",
  "person.language",
  "person.phone",
  "company.domain",
  "company.hierarchy",
  "company.b2b_social",
  "company.icon",
  "company.description",
] as const;

export const SubmitFeedbackInput = {
  category: z
    .enum(FEEDBACK_CATEGORY_VALUES)
    .describe(
      "api_schema = request/response shape, naming, errors, docs. mcp = MCP tools and setup. data_quality = wrong/stale/missing values on a field. provider_request = a data vendor KingMinos should include. endpoint_request = a new endpoint or field. workflow_friction = it worked but was hard. product_idea = anything else.",
    ),
  summary: z
    .string()
    .min(15)
    .max(150)
    .describe(
      "Plain-English headline, 15-150 chars, no IDs and no error text - similar reports group together under it.",
    ),
  details: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      "What happened, up to 4000 chars. Free text, read only by the KingMinos team. No personal data, no secrets.",
    ),
  source: z
    .enum(["user", "agent"])
    .describe(
      "user = the person's own words. agent = something you (the agent) noticed.",
    ),
  capability: z
    .enum(FEEDBACK_CAPABILITY_VALUES)
    .optional()
    .describe("Which KingMinos capability. Required for data_quality."),
  run_id: z
    .string()
    .optional()
    .describe(
      "Run id from the response you are reporting on - links the report to the exact call. Important for data_quality.",
    ),
  requested: z
    .string()
    .max(200)
    .optional()
    .describe(
      "The provider, endpoint or field you wanted. Required for provider_request / endpoint_request.",
    ),
  task_context: z
    .string()
    .max(1000)
    .optional()
    .describe("What you were trying to do, without the actual values."),
  sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
};

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
    schema:
      typeof body.schema_version === "string" ? body.schema_version : undefined,
    idempotencyKey:
      typeof idempotencyKey === "string" ? idempotencyKey : undefined,
    cacheBypass: cacheBypass === true || body.skip_cache === true,
  };
}
