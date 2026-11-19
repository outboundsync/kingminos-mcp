/**
 * What connected apps (OAuth callers: ChatGPT, Claude, Cursor / Grok Bot, HubSpot
 * agents, Agentforce) see for each tool: a short plain description and only the
 * subject inputs. Directory reviews reject vendor names, model-steering text and
 * — inside ChatGPT — prices or credit talk, so none of that appears here. The
 * full API-reference descriptions, routing knobs and per-call prices stay for
 * API-key callers (IDEs, scripts, Salesforce Flow). Field types are reused from
 * TOOL_SPECS so required/optional rules never drift; only descriptions change.
 */
import type { ZodTypeAny } from "zod";
import type { ToolName } from "./catalog.js";

export interface DirectoryToolCopy {
  description: string;
  /** Input field → plain description. `null` keeps the field's own description. */
  fields: Record<string, string | null>;
}

/** Tools connected apps never see (the API still serves them to API keys). */
export const DIRECTORY_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  // Returns the data-provider registry; not useful to an assistant and names vendors.
  "get_providers",
]);

const COMPANY = {
  domain: "Company website domain, like acme.com.",
  website: "Company website URL.",
  email: "Any work email at the company.",
  name: "Company name.",
};

const PERSON = {
  email: "The person's email address.",
  linkedin_url: "The person's LinkedIn profile URL.",
  first_name: "The person's first name, used only to confirm the match.",
  last_name: "The person's last name, used only to confirm the match.",
};

export const DIRECTORY_TOOL_COPY: Readonly<
  Partial<Record<ToolName, DirectoryToolCopy>>
> = {
  get_capabilities: {
    description:
      "List the lookups KingMinos can run and the inputs each one needs.",
    fields: {},
  },
  get_recipes: {
    description:
      "List common multi-step workflows, such as finding a company's domain and then its LinkedIn page.",
    fields: {},
  },
  get_balance: {
    description: "Show the connected workspace's current balance.",
    fields: {},
  },
  get_balance_health: {
    description:
      "Check whether the connected workspace can run more lookups right now.",
    fields: {},
  },
  company_resolve: {
    description:
      "Identify a company from its domain, website or a work email. Returns the company name and primary domain, or no decision.",
    fields: {
      domain: COMPANY.domain,
      website: COMPANY.website,
      email: COMPANY.email,
      name: COMPANY.name,
    },
  },
  company_domain: {
    description:
      "Find or confirm a company's primary website domain from its name, website or a work email, and say whether it was verified, corrected or discovered.",
    fields: {
      name: COMPANY.name,
      domain: "The domain on record, if any, like acme.com.",
      website: COMPANY.website,
      email: COMPANY.email,
      linkedin_url: "The company's LinkedIn page URL, if known.",
    },
  },
  company_hierarchy: {
    description: "Find a company's immediate and ultimate parent company.",
    fields: {
      domain: COMPANY.domain,
      website: COMPANY.website,
      email: COMPANY.email,
      name: COMPANY.name,
    },
  },
  company_b2b_social: {
    description: "Find a company's LinkedIn page URL.",
    fields: {
      domain: COMPANY.domain,
      website: COMPANY.website,
      email: COMPANY.email,
      name: COMPANY.name,
    },
  },
  company_x_account: {
    description: "Find a company's X (Twitter) account.",
    fields: {
      domain: COMPANY.domain,
      website: COMPANY.website,
      email: COMPANY.email,
      name: COMPANY.name,
    },
  },
  company_icon: {
    description: "Get a square icon image URL for a company.",
    fields: { domain: COMPANY.domain, name: COMPANY.name },
  },
  company_description: {
    description:
      "Write a short, factual, third-person description of what a company does.",
    fields: {
      domain: COMPANY.domain,
      website: COMPANY.website,
      email: COMPANY.email,
      name: COMPANY.name,
    },
  },
  person_verify_employment: {
    description:
      "Check whether a person still works at the company on record, from their work email or LinkedIn URL.",
    fields: { ...PERSON },
  },
  person_language: {
    description:
      "Check whether English is fine for reaching a person, and if not, which language to use.",
    fields: { ...PERSON },
  },
  person_phone: {
    description:
      "Find a person's direct phone number from their work email or LinkedIn URL.",
    fields: { ...PERSON },
  },
  person_title: {
    description: "Find a person's current job title, seniority and function.",
    fields: {
      ...PERSON,
      company_domain: "The person's company domain, like acme.com.",
    },
  },
  person_b2b_social: {
    description:
      "Find a person's LinkedIn profile URL from their email address.",
    fields: {
      email: PERSON.email,
      first_name: PERSON.first_name,
      last_name: PERSON.last_name,
    },
  },
  person_name: {
    description:
      "Get a clean first and last name for a person from their email address or LinkedIn URL.",
    fields: { email: PERSON.email, linkedin_url: PERSON.linkedin_url },
  },
  person_email: {
    description:
      "Find a person's work email from their name and company domain, or from their LinkedIn URL.",
    fields: {
      first_name: "The person's first name.",
      last_name: "The person's last name.",
      company_domain: "The person's company domain, like acme.com.",
      linkedin_url: PERSON.linkedin_url,
    },
  },
  email_verify: {
    description: "Check whether an email address can receive mail.",
    fields: { email: "The email address to check." },
  },
  get_run: {
    description: "Look up an earlier lookup by its run id.",
    fields: { id: "The run id, like run_…" },
  },
  submit_feedback: {
    description:
      "Send product feedback to the KingMinos team. Not a support channel.",
    fields: {
      category: null,
      summary: null,
      details: null,
      capability: null,
      run_id: null,
    },
  },
};

/** Connected-app input schema: the listed fields only, with plain descriptions. */
export function directoryInputSchema(
  copy: DirectoryToolCopy,
  full: Record<string, ZodTypeAny>,
): Record<string, ZodTypeAny> {
  const out: Record<string, ZodTypeAny> = {};
  for (const [name, text] of Object.entries(copy.fields)) {
    const field = full[name];
    if (field) {
      out[name] = text === null ? field : field.describe(text);
    }
  }
  return out;
}

/** Server instructions for connected apps: what it does, no steering, no prices. */
export const DIRECTORY_INSTRUCTIONS =
  "KingMinos is a data enrichment router: each lookup returns one decided answer about a company or person. Read answer.outcome and es_decision — a miss is a normal result, not an error.";
