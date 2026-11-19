/**
 * Result card for connected apps (OAuth callers): one small HTML view that
 * ChatGPT and Claude render under a lookup's answer. Off unless
 * `MCP_RESULT_CARDS=on`, and never for API-key callers.
 *
 * The card reads `structuredContent`, which is the API JSON cut down to
 * answer.{outcome, es_decision, confidence, reason_code} plus the few result
 * fields the card shows. answer.summary is left out because it can name a data
 * provider.
 */
import type { ToolName } from "./catalog.js";
import { envString, type RuntimeEnv } from "./env.js";
import { RESULT_CARD_HTML } from "./result-card-html.js";

export { RESULT_CARD_HTML };

/** Bump the version suffix whenever the HTML changes; hosts cache templates by URI. */
export const RESULT_CARD_URI = "ui://kingminos/result-card-v1.html";

/** MCP Apps view MIME type (ext-apps spec 2026-01-26; ChatGPT uses the same). */
export const RESULT_CARD_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Resource `_meta`: the only remote content is a hosted company icon; no
 * fetches (connectDomains empty). The host draws the card border.
 */
export const RESULT_CARD_RESOURCE_META = Object.freeze({
  ui: {
    csp: {
      connectDomains: [] as string[],
      resourceDomains: ["https://logos.kingminos.com"],
    },
    prefersBorder: true,
  },
});

/**
 * Tool `_meta` for lookups: MCP Apps `ui.resourceUri`, plus ChatGPT's
 * `openai/outputTemplate` alias for the same URI.
 */
export const RESULT_CARD_TOOL_META = Object.freeze({
  ui: { resourceUri: RESULT_CARD_URI },
  "openai/outputTemplate": RESULT_CARD_URI,
});

export function resultCardsEnabled(env: RuntimeEnv): boolean {
  return envString(env, "MCP_RESULT_CARDS") === "on";
}

/** Result paths the card shows per lookup, in display order. */
export const RESULT_CARD_FIELDS: Readonly<
  Partial<Record<ToolName, readonly string[]>>
> = {
  company_resolve: [
    "company_name",
    "company_domain",
    "website",
    "linkedin_url",
  ],
  company_domain: [
    "company_name",
    "account_primary_domain",
    "company_domain",
    "linkedin_url",
  ],
  company_hierarchy: [
    "company_name",
    "company_domain",
    "immediate_parent_name",
    "immediate_parent_domain",
    "ultimate_parent_name",
    "ultimate_parent_domain",
  ],
  company_b2b_social: ["company_name", "company_domain", "linkedin_url"],
  company_x_account: ["company_name", "company_domain", "x_handle", "x_url"],
  company_icon: ["company_name", "company_domain", "icon_url"],
  company_description: ["company_domain", "description"],
  person_verify_employment: [
    "person.first_name",
    "person.last_name",
    "person.job_title",
    "company_name",
    "company_domain",
    "employment",
  ],
  person_language: [
    "person.first_name",
    "person.last_name",
    "recommended_language_name",
    "english",
    "local_language_name",
  ],
  person_phone: [
    "person.first_name",
    "person.last_name",
    "best_phone.e164",
    "best_phone.type",
    "person.linkedin_url",
  ],
  person_title: [
    "person.first_name",
    "person.last_name",
    "title",
    "seniority",
    "function",
    "company.name",
  ],
  person_b2b_social: ["person.first_name", "person.last_name", "linkedin_url"],
  person_name: ["full_name", "first_name", "last_name"],
  person_email: [
    "person.first_name",
    "person.last_name",
    "email",
    "email_status",
    "person.linkedin_url",
  ],
  email_verify: ["email", "status"],
};

const ANSWER_FIELDS = ["outcome", "es_decision", "confidence", "reason_code"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShown(value: unknown): value is string | number | boolean {
  return (
    (typeof value === "string" && value.length > 0) ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Copy `path` (dotted) from `from` into `into`, keeping the nesting. */
function copyPath(
  from: Record<string, unknown>,
  into: Record<string, unknown>,
  path: string,
): void {
  const keys = path.split(".");
  let source: unknown = from;
  for (const key of keys) {
    source = isRecord(source) ? source[key] : undefined;
  }
  if (!isShown(source)) {
    return;
  }
  let target = into;
  for (const key of keys.slice(0, -1)) {
    if (!isRecord(target[key])) {
      target[key] = {};
    }
    target = target[key] as Record<string, unknown>;
  }
  target[keys.at(-1) as string] = source;
}

export interface ResultCardContent {
  [key: string]: unknown;
  capability?: string;
  answer: Record<string, unknown>;
  result: Record<string, unknown>;
  /** Result paths in display order (the tool's RESULT_CARD_FIELDS). */
  fields: string[];
}

/**
 * The card's `structuredContent`, or undefined when `tool` has no card or the
 * payload is not a lookup envelope.
 */
export function resultCardContent(
  tool: ToolName,
  payload: unknown,
): ResultCardContent | undefined {
  const fields = RESULT_CARD_FIELDS[tool];
  if (!fields || !isRecord(payload) || !isRecord(payload.answer)) {
    return undefined;
  }
  const answer: Record<string, unknown> = {};
  for (const key of ANSWER_FIELDS) {
    copyPath(payload.answer, answer, key);
  }
  if (!("es_decision" in answer) && isShown(payload.es_decision)) {
    answer.es_decision = payload.es_decision;
  }
  const result: Record<string, unknown> = {};
  if (isRecord(payload.result)) {
    for (const path of fields) {
      copyPath(payload.result, result, path);
    }
  }
  return {
    ...(typeof payload.capability === "string"
      ? { capability: payload.capability }
      : {}),
    answer,
    result,
    fields: [...fields],
  };
}
