import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodTypeAny } from "zod";
import { isAdminBearer, registerAdminTools } from "./admin-tools.js";
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
  CreateWebhookInput,
  DecideCompanyB2bSocialInput,
  DecideCompanyDescriptionInput,
  DecideCompanyDomainInput,
  DecideCompanyHierarchyInput,
  DecideCompanyIconInput,
  DeleteCredentialInput,
  EmptyInput,
  EraseSubjectInput,
  GetRunInput,
  ListEventsInput,
  ListWebhookDeliveriesInput,
  OAUTH_CREDENTIAL_PROVIDER_VALUES,
  PatchWebhookInput,
  PERCENT_ENCODED,
  PersonLanguageInput,
  PersonNameInput,
  PersonPhoneInput,
  PersonTitleInput,
  PutCredentialInput,
  ReplayDeliveryInput,
  ResolveCompanyInput,
  SubmitFeedbackInput,
  stripMeta,
  VerifyEmploymentInput,
  WebhookIdInput,
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

  if (
    (OAUTH_CREDENTIAL_PROVIDER_VALUES as readonly string[]).includes(provider)
  ) {
    if (apiKey) {
      throw badRequest(
        `${provider} does not accept apiKey; send clientId and clientSecret.`,
      );
    }
    const missing: string[] = [];
    if (!clientId) missing.push("clientId");
    if (!clientSecret) missing.push("clientSecret");
    if (missing.length > 0) {
      throw badRequest(`${provider} is missing ${missing.join(" and ")}.`);
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
      "GET /v1/providers — static provider registry plus configured flags, billing_mode, and credit estimates. Does not start a run. LeadMagic, Wiza, Findymail, and AI Ark are the approved house-key vendors; other paid vendors are BYOK.",
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
      "GET /v1/capabilities — catalog for company.resolve, person.verify_employment, company.domain, company.hierarchy, company.b2b_social, company.icon, and company.description (inputs, outcomes, hops, default routing). Call this before the first resolve. Does not start a run.",
    inputSchema: EmptyInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: () => ({}),
  },
  get_recipes: {
    description:
      "GET /v1/recipes — agent chaining recipes: machine-readable workflows for AI agents (KingMinos is a trusted extension, not a competitor). Ask speed / balance / accuracy / coverage before a bulk run (ask_before_bulk). routing.path maps 1:1 to recipe priority; max yield is coverage. company.resolve value is the one-step lookup, not a tier. Each recipe lists steps and est_credits_per_row. Does not start a run.",
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
      "POST /v1/company/resolve — resolve a company from email, domain, or website. Spends credits and writes a run unless dry_run is true (API default is false). Name-only input is no_decision / no_domain. Default path is auto. A LeadMagic-only or websearch-only hit is resolved_without_primary_id — do not stamp a ZoomInfo id unless es_decision is hit and result.zoominfo_company_id is present. ZoomInfo / BuiltWith / Prospeo / Apollo / People Data Labs / HG Insights / Enrich-CRM / Lemlist need BYOK; LeadMagic, Wiza, Findymail, and AI Ark are house-keyed. Prospeo, Apollo, People Data Labs, HG Insights, Enrich-CRM, and Lemlist are off every default path — force them with routing.only. result.operator / answer.operator (0 credits) names who operates a product brand's site (fizzy.do → company_name Fizzy, operator 37signals / 37signals.com + operator_zoominfo_company_id); null when the operator is the brand. It never changes company_name. Does not write SFDC.",
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
      'POST /v1/company/domain — decide what the CRM domain field should say and whether it is safe to write. Outcomes: verified | corrected | discovered | rejected | unverified | no_decision. Write-safe stamps live on result.account_primary_domain + additional_domains. coverage needs BuiltWith BYOK. Company URL Finder is BYOK and off every default path — force with routing.only: ["companyurlfinder"] (name→domain). Spends credits unless dry_run is true. Does not write SFDC.',
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
  company_b2b_social: {
    description:
      "POST /v1/company/b2b-social — decide the company LinkedIn page URL (or null). Domain/website/email required; name-only is 400. speed is websearch only (cap 1). balance (default) runs websearch then house AI Ark even after a search candidate (cap 2). accuracy adds LeadMagic, house AI Ark, then Wiza (cap 18). coverage adds Findymail (cap 19). Default stacks are house keys only. BYOK ZoomInfo / Apollo / Prospeo / Company URL Finder need routing.only. Output result.linkedin_url is Serper-confirmed https://www.linkedin.com/company/{slug} or null. Spends credits unless dry_run is true. Does not write SFDC.",
    inputSchema: DecideCompanyB2bSocialInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  company_icon: {
    description: [
      "POST /v1/company/icon — fetch, validate, normalize, and host a 256×256 PNG company icon for a domain.",
      "Request body is required domain, optional name, and run options (routing, path, and preset are not part of the contract; the API silently ignores them if sent). website and email are not accepted — use domain directly.",
      "One implementation ladder (0–2 paid credits): house favicon-fetch (dns/site_probe, 0) → Brandfetch BYOK (1, soft-fail) → ZoomInfo enrich logo (1). Brandfetch and ZoomInfo need put_credentials.",
      "On a hit, result.icon_url is always the KingMinos-hosted URL https://logos.kingminos.com/i/<sha256>.png (256×256 PNG in R2), never a third-party, site, Brandfetch, or ZoomInfo URL.",
      "Optional result.icon_source_url holds the original winning source URL before hosting.",
      "Hard rejects are wrong-company, junk, and empty only.",
      "A source under 64px is still a hosted hit: answer.confidence low, result.flags.low_res true, and answer.safe_to_write.icon_url true (upscaled to 256×256 in R2).",
      "Fetch or store failure is a miss with result.icon_url null.",
      "answer.safe_to_write.icon_url is true on any hosted logos.kingminos.com hit (including low-res); false on misses.",
      "Not sourced from LeadMagic, AI Ark, Prospeo, or Enrich-CRM.",
      "Spends credits unless dry_run is true. Does not write SFDC.",
    ].join(" "),
    inputSchema: DecideCompanyIconInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  company_description: {
    description: [
      "POST /v1/company/description — decide a usable English company description (result.description) or null for a domain/website/email subject. max_chars 80–500 (default 300).",
      "Domain/website/email required; name-only is 400.",
      "Engine first_acceptable; hits-first on every path. Hard rejects are wrong company (identity < 0.85), junk/PII, and empty.",
      "Paths speed | balance | accuracy | coverage are distinct ladders (not aliases), each under ~10s; always pass path explicitly (omit runs balance at cap 6; path balance is cap 2).",
      "speed = homepage meta/og with deterministic gates, then house AI Ark (cap 1).",
      "balance = Jev-ranked homepage extracts + meta/og + AI Ark, optional websearch rewrite (cap 2 when path is balance explicitly).",
      "accuracy = xAI neutral third-person compose from homepage evidence with one Jev identity judge (cap 3); falls back to the cheaper hit.",
      "coverage = accuracy compose plus off-homepage Serper / ZoomInfo BYOK evidence (cap 6); cannot miss where accuracy hit.",
      "AI Ark is the only firmographic vendor. LeadMagic, Wiza, Findymail, Brandfetch, Lemlist, and Snov.io are not company.description vendors.",
      "ZoomInfo is BYOK-only via put_credentials (never the house key).",
      "result.flags hype, first_person, tagline, same_as_speed, truncated, cta, grammar are quality flags, not misses (flags may gain new keys; do not reject unknown ones); truncated and cta force answer.confidence low; grammar is informational only and does not affect confidence or safe_to_write.",
      "answer.confidence is high | medium | low. answer.identity {method: jev | name_domain | own_homepage, score} is the identity basis (null when not identity-judged).",
      "answer.safe_to_write.description is true only on a hit with non-low confidence and a non-null answer.identity; low is never safe to write.",
      "Billing is winner-only (usage.hops, usage.credits.by_provider); rejected/lost hops and misses cost 0.",
      "Cache bypass skips the 30-day result-cache read (still writes; does not skip Idempotency-Key replay): skip_cache true or cache_bypass true (X-Router-Cache bypass; other header values are 400). Cache-Control no-cache or no-store is API-only over direct HTTP. company.resolve ignores bypass inputs and may return a cached answer.",
      "Spends credits unless dry_run is true. Does not write SFDC.",
    ].join(" "),
    inputSchema: DecideCompanyDescriptionInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  person_verify_employment: {
    description:
      "POST /v1/person/verify-employment — pre-flight whether to send to this person. Default path is balance (LeadMagic email validate + optional paid LinkedIn lookup). speed is LeadMagic validate only. accuracy adds AI Ark (house-keyed). Findymail is a house-key Layer-1 alternate only when routing.only selects it — never stacked after LeadMagic. Outcomes: high_confidence_send | low_confidence_send | low_confidence_block | high_confidence_block | no_decision. Spends credits unless dry_run is true. Does not write SFDC.",
    inputSchema: VerifyEmploymentInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  person_language: {
    description: [
      "POST /v1/person/language — can we engage this person in English, and if not, in what language? Input email or linkedin_url (one required, else 400 email_or_linkedin_required); first_name / last_name are match-only (reject someone else's profile → person_mismatch), never used to infer a language.",
      "result.english is yes | likely | unconfirmed | unknown (never no). result.recommended_language (ISO 639-1; English whenever english=yes) and result.local_language (strongest non-English) are set only at medium or high; low guesses stay in result.languages [{code, name, confidence, level, evidence[]}]. result.detected, result.flags (weak_signals, multilingual_country, conflicting_signals, unconfirmed_identity), result.person.",
      "Confidence is a heuristic 0–1 score (high ≥ 0.75, medium ≥ 0.5), not a calibrated probability.",
      "routing.path: speed (cap 1: one profile read + language judge) | balance (default, cap 3: LeadMagic by URL → AI Ark by email → Findymail only if AI Ark found no one → LeadMagic on a resolved URL) | accuracy (cap 4: every structured source, no early stop, + language judge). Only path/preset is read; coverage and anything else is 400 invalid_routing.",
      "decision.outcome hit iff recommended_language is set; low-only → no_decision/ambiguous; nothing found → zero_hits; no vendor answered → provider_error; skips → compliance_blocked | status_down | max_credits_reached | not_configured. answer.safe_to_write.recommended_language only on hit without conflicting_signals or unconfirmed_identity.",
      "Under compliance.soc2 LeadMagic and AI Ark are skipped; Findymail is the only source. Misses, vendor errors, and unconfigured cost 0.",
      "30-day cache: repeats replay with usage.cached true at 0 credits; skip_cache or cache_bypass skips the read (still writes). delete_subject (email:<addr> / li:<slug>) purges cached answers.",
      "Spends credits unless dry_run is true. Does not write SFDC.",
    ].join(" "),
    inputSchema: PersonLanguageInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  person_phone: {
    description: [
      "POST /v1/person/phone — one dialable phone number for a person by work email or LinkedIn URL, plus the ranked rest. Input email or linkedin_url (one required, else 400 email_or_linkedin_required); first_name / last_name are match-only (reject someone else's profile → person_mismatch), never used to infer anything.",
      "phone_types filters the answer (mobile | landline | other | unknown; omit = any); max_results caps result.phones (1–10, default 3); format picks the `number` string (e164 default | international | national | digits | digits_national). result.best_phone and each result.phones[] entry: {number, e164, formats {e164, international, national, digits, digits_national}, country_code, calling_code, type, line_type, source, sources, confidence, flags, safe_to_write}, or best_phone null; phones ranked safe-to-write first, then mobile, deduped, honoring the filter; result.flags [conflicting_numbers, numbers_dropped] or null; result.person (null on a miss).",
      "Verification at no extra cost: libphonenumber validity (invalid and junk numbers dropped), numbering-plan line type (toll-free / premium / pager and the company switchboard are not a direct dial — dropped), country consistency with the person's or company's location (country_mismatch lowers confidence), cross-source agreement (multi_source). Write only when answer.safe_to_write.best_phone is true.",
      "Agent-managed router, answers in < 10 s: every eligible vendor (ZoomInfo / QuickEnrich / Blitz BYOK, LeadMagic, AI Ark, Findymail US-only, Wiza) runs in parallel under a ~8.5 s budget; late vendors are dropped (bill 0). Four modes via routing.path: speed (LeadMagic first with a 3 s head start, then the cheapest fallbacks race it; cap 10, never Wiza), balance (default: best single number by vendor prior / region / line type, no waiting for agreement), accuracy (agreement required, exactly one number; conflicting_numbers → not safe), coverage (up to 5 ranked numbers, each with source, line type, confidence, consensus). consensus and do_not_call on every number; routing.only / ignore filter the pool. Only vendors behind returned numbers bill (coverage: each returned number), capped at 38 credits; 0 on a miss; BYOK 0.1. A filter no vendor can serve is not called (0 credits, insufficient_input / noop).",
      "Cost: 38 credits on a hit, 0 on a miss (ceiling 38). decision.outcome hit iff a usable number was found; nothing found → zero_hits (es_decision miss); no vendor answered → provider_error (error) or a skip reason (noop). answer.safe_to_write.best_phone is false when result.flags has conflicting_numbers or best_phone.safe_to_write is false — a wrong number is worse than none.",
      "30-day cache keyed on the request (filter included, format excluded): repeats replay with usage.cached true at 0 credits; skip_cache or cache_bypass skips the read (still writes). delete_subject (email:<addr> / li:<slug>) purges cached answers. Phone numbers are contact PII.",
      "API tenants only; spends credits unless dry_run is true. Does not write SFDC.",
    ].join(" "),
    inputSchema: PersonPhoneInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  person_title: {
    description: [
      "POST /v1/person/title — a person's current job title, seniority and function by work email or LinkedIn URL. Input email or linkedin_url (one required, else 400 email_or_linkedin_required); first_name / last_name are match-only (reject someone else's profile → person_mismatch), never used to infer anything; company_domain is match-only (a title at another employer is never a hit → employer_mismatch).",
      "fields picks the answer (title | seniority | function; omit = all three) and drives the ladder: it walks until every requested field is answered. result.title (cleaned), result.seniority (founder | c_suite | partner | vp | head | director | manager | senior | ic | entry | intern), result.function (sales | marketing | revenue_operations | customer_success | engineering | product | design | data | it | security | finance | people | legal | operations | executive | other), result.field_sources {method vendor | derived | jev, provider}, result.sources (accuracy / coverage), result.flags.",
      "routing.path: speed (one profile read, keywords only) | balance (default; ZoomInfo search on a BYOK key only, LeadMagic, AI Ark, Findymail) | accuracy (two independent sources + one judge call, 10 s cap) | coverage (adds AI Ark people search and Findymail whenever a second source is wanted). routing.only / routing.ignore are honored.",
      "Cost is outcome-priced: 1 / 2 / 3 / 5 credits on a hit (speed / balance / accuracy / coverage), 0 on a miss, a partial (fields_incomplete) or a timeout. decision.outcome hit iff every requested field is answered at medium or high confidence; some but not all → fields_incomplete (es_decision ambiguous, values withheld, result.answered_fields names what was found); nothing → zero_hits (miss, result.person null). answer.safe_to_write.title / seniority / function are false on conflicting_titles, unconfirmed_identity or employer_mismatch.",
      "30-day cache keyed on path, fields, company_domain and routing.only / ignore: repeats replay with usage.cached true at 0 credits; skip_cache or cache_bypass skips the read (still writes). delete_subject (email:<addr> / li:<slug>) purges cached answers.",
      "API tenants only; spends credits unless dry_run is true. Does not write SFDC.",
    ].join(" "),
    inputSchema: PersonTitleInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
    buildRequest: capabilityRequest,
  },
  person_name: {
    description: [
      "POST /v1/person/name — a person's proper-cased first / last / full name by email or LinkedIn URL, for CRM name stamps and personalization. Input email or linkedin_url (one required, else 400 email_or_linkedin_required); phone / x_handle are accepted but never looked up (unsupported_input, 0 credits). A role address (admin@, info@, …) is never a person (role_address, 0 credits).",
      "Salutations, titles, honorifics, suffixes, pronouns, emoji and URLs are stripped deterministically on every candidate at no cost; a judge call classifies only an ambiguous multi-token split (balance and above). result.first_name / last_name / full_name (proper-cased), result.name_source (vendor | email_local_parse), result.matched_on (which of email / linkedin_url the name came from), result.email_type (role | freemail | work), result.person (null on a miss), result.flags (email_local_parse, first_name_only, freemail, role_address, conflicting_names, unconfirmed_identity, single_source), result.evidence (candidates kept when a name is withheld below the floor).",
      "routing.path: speed (one profile read; never high) | balance (default; stops at the first usable name) | accuracy (same ladder + the judge on ambiguous splits; two agreeing independent sources are high, a disagreement is a conflict flagged conflicting_names) | coverage (balance ladder + a second source). routing.only / routing.ignore are honored.",
      "Cost is outcome-priced: 1 / 2 / 3 / 5 credits on a hit (speed / balance / accuracy / coverage), once on the deciding attempt; 0 on a miss, a conflict, a below-floor withhold or a timeout. answer.outcome resolved | parsed_only | role_address | not_found | conflict | unsupported_input; an email local-part split is a last resort only (parsed_only, low confidence, flagged email_local_parse).",
      "Write signal is answer.confidence only (there are no safe_to_write fields). Default floors: speed / coverage low, balance medium, accuracy high; min_confidence overrides. Below the floor the name fields are blank and the candidates stay in result.evidence.",
      "30-day cache keyed on path, min_confidence and routing.only / ignore: repeats replay with usage.cached true at 0 credits; skip_cache or cache_bypass skips the read (still writes). delete_subject (email:<addr> / li:<slug>) purges cached answers. A suppressed email / linkedin_url is 451 subject_suppressed at 0 credits.",
      "API tenants only; spends credits unless dry_run is true. Does not write SFDC.",
    ].join(" "),
    inputSchema: PersonNameInput,
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
      "GET /v1/credentials — masked Your Keys catalog (provider, status, mask). Never returns raw keys. A tenant Bearer lists tenant_provider_credentials. LeadMagic, Wiza, Findymail, and AI Ark without a stored row are managed (house key). Other vendors are unset until stored.",
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
      "ZoomInfo and Snov.io use { clientId, clientSecret }. Other vendors use { apiKey }.",
      "Response never echoes the raw key. LeadMagic, Wiza, Findymail, and AI Ark are the approved house-key vendors; storing those keys is optional.",
      "ZoomInfo, BuiltWith, Prospeo, Apollo, Company URL Finder, People Data Labs, HG Insights, Brandfetch, Enrich-CRM, Lemlist, Snov.io, Cognism, Lusha, Starbridge, Clay, Databar, QuickEnrich, GetLeads, and BlitzAPI are BYOK. Websearch cannot be stored.",
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
  list_webhooks: {
    description:
      "GET /v1/webhooks — workspace webhook endpoints (kmwhk_…). 403 webhooks_not_enabled while the workspace gate is off (an OutboundSync admin toggles it). All webhook tools need a key carrying the explicit `webhooks` scope (403 webhook_scope_required otherwise; capability:* does not include it). Never returns signing secrets.",
    inputSchema: EmptyInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: () => ({}),
  },
  create_webhook: {
    description: [
      "POST /v1/webhooks — register an HTTPS webhook endpoint. Returns the endpoint plus the signing secret (kmwhsec_…) shown once — tell the user to store it immediately; it is never shown again.",
      "HTTPS only; private/loopback/link-local targets (including DNS-resolved) are rejected. Max 20 endpoints per workspace. enabled_events holds active types only (empty or omitted = all active); reserved names return 400 invalid_webhook_events.",
      "Confirm with the user first.",
    ].join(" "),
    inputSchema: CreateWebhookInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
    buildRequest: (args) => ({
      body: {
        url: args.url,
        description: args.description,
        enabled_events: args.enabled_events,
      },
    }),
  },
  get_webhook: {
    description:
      "GET /v1/webhooks/{id} — one endpoint: url, description, enabled_events, is_active, consecutive_failures, auto_disabled_at. No secret.",
    inputSchema: WebhookIdInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { id: String(args.id ?? "") },
    }),
  },
  patch_webhook: {
    description:
      "PATCH /v1/webhooks/{id} — update url, description, enabled_events, or is_active. Re-enabling (is_active: true) clears the auto-disable state. Owner only. Confirm with the user first.",
    inputSchema: PatchWebhookInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { id: String(args.id ?? "") },
      body: {
        url: args.url,
        description: args.description,
        enabled_events: args.enabled_events,
        is_active: args.is_active,
      },
    }),
  },
  delete_webhook: {
    description:
      "DELETE /v1/webhooks/{id} — soft-delete the endpoint (deleted_at). Owner only. Confirm with the user first.",
    inputSchema: WebhookIdInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: true,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { id: String(args.id ?? "") },
    }),
  },
  rotate_webhook_secret: {
    description:
      "POST /v1/webhooks/{id}/rotate-secret — the previous secret stops working immediately (no grace window); the new secret (kmwhsec_…) is returned once in this response. Have the receiver ready, rotate, then update the receiver's secret at once. Owner only. Confirm with the user first.",
    inputSchema: WebhookIdInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: true,
      idempotentHint: false,
    },
    buildRequest: (args) => ({
      pathParams: { id: String(args.id ?? "") },
    }),
  },
  test_webhook: {
    description:
      "POST /v1/webhooks/{id}/test — queues a signed test.ping delivery (202 { event_id }); ignores enabled_events. Follow with list_webhook_deliveries and require succeeded. Owner only.",
    inputSchema: WebhookIdInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
    buildRequest: (args) => ({
      pathParams: { id: String(args.id ?? "") },
    }),
  },
  list_webhook_deliveries: {
    description:
      "GET /v1/webhooks/{id}/deliveries — delivery log: status (pending | succeeded | failed | dead), attempt_count, last_http_status, last_error, next_attempt_at. status filter, limit ≤ 100.",
    inputSchema: ListWebhookDeliveriesInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      pathParams: { id: String(args.id ?? "") },
      query: {
        status: args.status ? String(args.status) : undefined,
        limit: args.limit === undefined ? undefined : String(args.limit),
      },
    }),
  },
  replay_webhook_delivery: {
    description:
      "POST /v1/webhooks/{id}/deliveries/{delivery_id}/replay — create a new delivery for the same event (linked via replay_of_delivery_id) and dispatch it. Use after fixing the receiver or an auto-disable. Owner only. Confirm with the user first.",
    inputSchema: ReplayDeliveryInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: false,
    },
    buildRequest: (args) => ({
      pathParams: {
        id: String(args.id ?? ""),
        delivery_id: String(args.delivery_id ?? ""),
      },
    }),
  },
  list_events: {
    description:
      "GET /v1/events — emitted platform events, the reconciliation log. Queryable even when no webhook was active; recover misses here, then replay. Filters: type (run.failed | run.recovered | test.ping), delivered, limit ≤ 200, keyset cursor (next_cursor).",
    inputSchema: ListEventsInput,
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      idempotentHint: true,
    },
    buildRequest: (args) => ({
      query: {
        type: args.type === undefined ? undefined : String(args.type),
        delivered:
          args.delivered === undefined ? undefined : String(args.delivered),
        limit: args.limit === undefined ? undefined : String(args.limit),
        cursor: args.cursor === undefined ? undefined : String(args.cursor),
      },
    }),
  },
  submit_feedback: {
    description: [
      "POST /v1/feedback — file KingMinos product feedback. Free: never costs credits, and it is not a support channel.",
      "Use it when a call misses or comes back low-confidence, when you had to work around KingMinos, or when you wanted a field or provider we don't have — responses that miss also carry a feedback_hint pointing here.",
      "category: api_schema (request/response shape, naming, errors, docs) | mcp (tools, behavior, setup) | data_quality (wrong/stale/missing values on a field) | provider_request (a data vendor KingMinos should include) | endpoint_request (a new endpoint or field) | workflow_friction (it worked but was hard) | product_idea (anything else).",
      "summary is a 15-150-char plain-English headline with no IDs and no error text, so similar reports group together; details up to 4000 chars; source: user (the person's own words) or agent (you noticed).",
      "Optional: capability (required for data_quality), run_id (links the exact call — important for data_quality), requested (the provider/endpoint/field wanted — required for provider_request and endpoint_request), task_context, sentiment.",
      "No personal data and no secrets — secret-shaped content is rejected. ~20 reports per key per 24h; an identical same-day retry is deduped for free. Rate limit 429 includes Retry-After.",
    ].join(" "),
    inputSchema: SubmitFeedbackInput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    buildRequest: (args) => ({
      body: Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined),
      ),
    }),
  },
};

function asApiMethod(method: string): ApiMethod {
  if (
    method === "GET" ||
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
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
      instructions: isAdminBearer(context.bearer)
        ? "KingMinos admin tools (admin token): abuse_report and partner_report are read-only D1 reports (JSON or CSV); partner_payout lists pending payouts and can approve-and-pay one (Stripe transfer or credits) or record a manual payout; partner_admin lists partners (with codes and share links), creates a partner + code, adds or deactivates a code. Approving moves money, so get the user's explicit OK for partner, amount and month first."
        : [
            `${PRODUCT_NAME} wraps the live enrichment API at https://api.kingminos.com.`,
            "Call get_capabilities before the first resolve so routing defaults are current.",
            "LeadMagic, Wiza, Findymail, and AI Ark are the approved house-key vendors. ZoomInfo, BuiltWith, Prospeo, Apollo, Company URL Finder, People Data Labs, HG Insights, Brandfetch, Enrich-CRM, Lemlist, Snov.io, Cognism, Lusha, Starbridge, Clay, Databar, QuickEnrich, GetLeads, and BlitzAPI are BYOK via put_credentials.",
            "Websearch is house-only and cannot be stored.",
            "Confirm with the user before put_credentials, delete_credentials, or delete_subject.",
            "Webhook mutations (create/patch/delete/rotate/test/replay) also need confirmation; signing secrets are shown once.",
            PUT_CREDENTIALS_WARNING,
            "Say SFDC, never SF. Branch automations on answer.outcome / es_decision — business misses stay HTTP 200.",
            "File feedback when a call misses, errors, comes back low-confidence, or you had to work around us or wanted a field or provider we don't have — submit_feedback is free and never costs credits.",
          ].join(" "),
    },
  );

  const bearerOf = (): string => requireBearer(context.bearer);
  const requestBaseUrl = context.apiBaseUrl;

  // Admin token: admin tools only (they never appear for tenant/user bearers).
  if (isAdminBearer(context.bearer)) {
    registerAdminTools(server, context.bearer as string, requestBaseUrl);
    return server;
  }

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
