/**
 * Capability prices, as the API publishes them.
 *
 * KingMinos has one pricing source (`GET https://api.kingminos.com/v1/pricing`);
 * each capability POST in the live OpenAPI spec carries that capability's slice
 * as `x-kingminos-pricing`. `npm run inventory:refresh` copies a compact form of
 * it into `inventory/openapi-surfaces.json` (`pricing`, keyed by tool name) and
 * writes `src/pricing.generated.ts` from it, which the server imports. Tool
 * descriptions show prices only through `priceLine()`; nothing here or in a
 * tool description is typed by hand.
 */

export type ByokBasis = "per_answer" | "per_billing_hop";

/** One product path. `delivered` is a number when the API fixes one price, else a range. */
export interface PathPrice {
  name: string;
  cap: number;
  delivered: number | { min: number; max: number };
  byok: number;
  miss: number;
}

/** An off-default hop that bills its own price when it decides. */
export interface OptInHopPrice {
  provider: string;
  price: number;
}

export interface CapabilityPricing {
  /** Dotted capability id, e.g. `company.b2b_social`. */
  id: string;
  byokBasis: ByokBasis;
  paths: PathPrice[];
  optInHops: OptInHopPrice[];
}

/** Tool name (snake_case operationId) → that capability's prices. */
export type PricingMap = Record<string, CapabilityPricing>;

export const PRICING_EXTENSION = "x-kingminos-pricing";
export const PRICING_MODULE_RELATIVE = "src/pricing.generated.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${where} must be a finite number >= 0`);
  }
  return value;
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where} must be a non-empty string`);
  }
  return value;
}

function deliveredPrice(value: unknown, where: string): PathPrice["delivered"] {
  if (typeof value === "number") {
    return finiteNumber(value, where);
  }
  if (!isRecord(value)) {
    throw new Error(`${where} must be a number or {min, max}`);
  }
  const min = finiteNumber(value.min, `${where}.min`);
  const max = finiteNumber(value.max, `${where}.max`);
  if (min > max) {
    throw new Error(`${where}.min is above max`);
  }
  // `typical` is set only when min == max; then it is one price.
  return min === max ? min : { min, max };
}

/**
 * Compact a capability's `x-kingminos-pricing` block (spec, snake_case) or a
 * pinned inventory entry (camelCase). Throws on anything malformed so a bad
 * spec fails the refresh instead of dropping prices.
 */
export function compactPricing(raw: unknown, where: string): CapabilityPricing {
  if (!isRecord(raw)) {
    throw new Error(`${where} must be an object`);
  }
  const id = nonEmptyString(raw.id, `${where}.id`);
  const basis = raw.byokBasis ?? raw.byok_basis;
  if (basis !== "per_answer" && basis !== "per_billing_hop") {
    throw new Error(
      `${where}.byok_basis must be per_answer or per_billing_hop`,
    );
  }
  if (!Array.isArray(raw.paths) || raw.paths.length === 0) {
    throw new Error(`${where}.paths must be a non-empty array`);
  }
  const paths = raw.paths.map((item, index): PathPrice => {
    const at = `${where}.paths[${index}]`;
    if (!isRecord(item)) {
      throw new Error(`${at} must be an object`);
    }
    return {
      name: nonEmptyString(item.name, `${at}.name`),
      cap: finiteNumber(item.cap, `${at}.cap`),
      delivered: deliveredPrice(item.delivered, `${at}.delivered`),
      byok: finiteNumber(item.byok, `${at}.byok`),
      miss: finiteNumber(item.miss, `${at}.miss`),
    };
  });
  const hopsRaw = raw.optInHops ?? raw.opt_in_hops ?? [];
  if (!Array.isArray(hopsRaw)) {
    throw new Error(`${where}.opt_in_hops must be an array`);
  }
  const optInHops = hopsRaw.map((item, index): OptInHopPrice => {
    const at = `${where}.opt_in_hops[${index}]`;
    if (!isRecord(item)) {
      throw new Error(`${at} must be an object`);
    }
    return {
      provider: nonEmptyString(item.provider, `${at}.provider`),
      price: finiteNumber(item.price, `${at}.price`),
    };
  });
  return { id, byokBasis: basis, paths, optInHops };
}

export function parsePricingMap(
  value: unknown,
  where: string,
): PricingMap | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object keyed by tool name`);
  }
  const out: PricingMap = {};
  for (const [tool, entry] of Object.entries(value)) {
    out[tool] = compactPricing(entry, `${where}.${tool}`);
  }
  return out;
}

/** Plain decimal, no float noise (1.2, never 1.2000000000000002). */
export function formatCredits(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function deliveredText(delivered: PathPrice["delivered"]): string {
  return typeof delivered === "number"
    ? formatCredits(delivered)
    : `${formatCredits(delivered.min)}–${formatCredits(delivered.max)}`;
}

function sameForAll(values: readonly number[]): number | undefined {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first)
    ? first
    : undefined;
}

/**
 * The one sentence a capability tool uses to state its price, e.g.
 * `Credits: speed 1 · balance 1.2 · accuracy 1.4 · coverage 1.4 (BYOK 0.1; a miss is free; opt-in wiza hop 15 instead of the path price when it decides).`
 */
export function priceLine(pricing: CapabilityPricing): string {
  const paths = pricing.paths
    .map((path) => `${path.name} ${deliveredText(path.delivered)}`)
    .join(" · ");

  const per = pricing.byokBasis === "per_billing_hop" ? " per billed hop" : "";
  const byok = sameForAll(pricing.paths.map((path) => path.byok));
  const byokText =
    byok !== undefined
      ? `BYOK ${formatCredits(byok)}${per}`
      : `BYOK${per} ${pricing.paths.map((path) => `${path.name} ${formatCredits(path.byok)}`).join(" · ")}`;

  const miss = sameForAll(pricing.paths.map((path) => path.miss));
  const missText =
    miss === 0
      ? "a miss is free"
      : miss !== undefined
        ? `a miss is ${formatCredits(miss)}`
        : `a miss is ${pricing.paths.map((path) => `${path.name} ${formatCredits(path.miss)}`).join(" · ")}`;

  const notes = [byokText, missText];
  for (const hop of pricing.optInHops) {
    notes.push(
      `opt-in ${hop.provider} hop ${formatCredits(hop.price)} instead of the path price when it decides`,
    );
  }
  return `Credits: ${paths} (${notes.join("; ")}).`;
}

/** Description text for a tool: its hand-written copy plus, for a priced capability, the price line. */
export function describeWithPrice(
  description: string,
  pricing: CapabilityPricing | undefined,
): string {
  return pricing ? `${description} ${priceLine(pricing)}` : description;
}

/** Source of `src/pricing.generated.ts`. Deterministic: same inventory, same bytes. */
export function renderPricingModule(pricing: PricingMap | undefined): string {
  const sorted: PricingMap = {};
  for (const tool of Object.keys(pricing ?? {}).sort()) {
    sorted[tool] = (pricing as PricingMap)[tool] as CapabilityPricing;
  }
  return [
    "// Generated from inventory/openapi-surfaces.json `pricing` by",
    "// `npm run inventory:refresh` / `npm run pricing:generate`. Do not edit:",
    "// prices come only from the API (x-kingminos-pricing in the live spec).",
    'import type { PricingMap } from "./pricing.js";',
    "",
    `export const CAPABILITY_PRICING: PricingMap = ${JSON.stringify(sorted, null, 2)};`,
    "",
  ].join("\n");
}

const NUMBER = String.raw`\d+(?:\.\d+)?`;

/**
 * Phrases that state a credit amount: "2 credits", "0–2 paid credits",
 * "cap 3", "capped at 38", "ceiling 38", "BYOK 0.1", "balance (default, 2)",
 * "speed 1 / balance 1.3", "1 / 2 / 3 / 5", "costs 2", "priced at 2".
 */
const CREDIT_PHRASES: readonly RegExp[] = [
  new RegExp(
    String.raw`${NUMBER}(?:\s*[–-]\s*${NUMBER})?[\s-]*(?:paid\s+)?credits?\b`,
    "gi",
  ),
  new RegExp(
    String.raw`\b(?:caps?|capped\s+at|ceiling(?:\s+of)?)\s+${NUMBER}(?:\s*/\s*${NUMBER})*`,
    "gi",
  ),
  new RegExp(String.raw`\bBYOK\b[^.;|)]{0,40}?${NUMBER}`, "gi"),
  new RegExp(
    String.raw`\b(?:speed|balance|accuracy|coverage)\s*\(?\s*(?:default,?\s*)?${NUMBER}(?:\s*[–-]\s*${NUMBER})?`,
    "gi",
  ),
  new RegExp(
    String.raw`${NUMBER}\s*/\s*${NUMBER}\s*/\s*${NUMBER}(?:\s*/\s*${NUMBER})*`,
    "g",
  ),
  new RegExp(
    String.raw`\b(?:costs?|bills?|charges?|priced\s+at|price\s+of)\s+${NUMBER}`,
    "gi",
  ),
];

/**
 * Credit amounts stated in `text` that are not free. Zero is allowed: "a miss
 * is free" / "0 credits" for outcomes the API never bills is a rule, not a
 * price. Anything else must come from the generated price line, so callers
 * remove that line first.
 */
export function creditNumbersIn(text: string): string[] {
  const found: string[] = [];
  for (const phrase of CREDIT_PHRASES) {
    for (const match of text.matchAll(phrase)) {
      const numbers = match[0].match(/\d+(?:\.\d+)?/g) ?? [];
      if (numbers.some((value) => Number(value) !== 0)) {
        found.push(match[0]);
      }
    }
  }
  return found;
}
