import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { apiBaseUrl, OPENAPI_FETCH_TIMEOUT_MS } from "./config.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SurfaceOperation {
  operationId: string;
  method: HttpMethod;
  path: string;
}

export interface ProviderLists {
  providers: string[];
  credentialProviders: string[];
}

export interface OpenApiInventory extends ProviderLists {
  publicNonToolPaths: string[];
  nonToolPathPrefixes: string[];
  excludedOperationIds: string[];
  /** Optional pin: allowed routing.only providers per capability id. */
  capabilityProviders?: Record<string, string[]>;
  operations: SurfaceOperation[];
}

export interface InventoryParseOptions {
  publicNonToolPaths?: readonly string[];
  nonToolPathPrefixes?: readonly string[];
  excludedOperationIds?: readonly string[];
}

export interface SurfaceDiff {
  missingTools: string[];
  extraTools: string[];
  missingRoutes: string[];
  extraRoutes: string[];
}

export interface ProviderDiff {
  missingProviderNames: string[];
  extraProviderNames: string[];
  missingCredentialProviders: string[];
  extraCredentialProviders: string[];
}

export type ProviderCheckMode = "pinned" | "live";

export interface ResolvedInventory {
  source: string;
  inventory: OpenApiInventory;
}

const HTTP_METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_INVENTORY_RELATIVE = "inventory/openapi-surfaces.json";
const LIVE_OPENAPI_JSON_PATHS = ["/openapi.json", "/v1/openapi.json"] as const;
const BEARER_SCHEME = "bearer";
const CREDENTIALS_PROVIDER_PATH = "/v1/credentials/{provider}";

export const INVENTORY_SPEC_URL = "https://api.kingminos.com/openapi.yaml";
export const INVENTORY_LIVE_OPENAPI_JSON_URL =
  "https://api.kingminos.com/openapi.json";

export const INVENTORY_SOURCE_BLURB =
  "KingMinos OpenAPI resource inventory (public contract). Paths verified against live GET https://api.kingminos.com/openapi.json. Tool names are snake_case resource operationIds. Only operations whose effective security includes the bearer scheme are required MCP tools. This file is not application source.";

export const INVENTORY_EXCLUSION_POLICY =
  "Session/cookie routes under /v1/auth/* and /v1/account/* are permanently out of scope for MCP. MCP authenticates with a tenant Bearer; those routes are app/session surfaces (login, workspaces, members, invites, tokens). nonToolPathPrefixes is the durable deny-list; excludedOperationIds is the reviewed catalog of omitted operationIds. Excluding a route is a reviewed decision, not a silent skip. Do not add account/auth MCP tools.";

export const INVENTORY_PROVIDERS_POLICY =
  "Pinned KingMinos OpenAPI provider enums for MCP Zod. CI fails when a pinned name is missing from ProviderName (routing.only) or CredentialProvider (put_credentials). Production OpenAPI may lag a merged BYOK provider (e.g. prospeo before the API Worker redeploys); npm run inventory:refresh unions live enums into this pin and never drops names. Live check (--live) is one-way: it fails only when the served spec lists a provider MCP Zod does not have.";

export const INVENTORY_PATH_ENV = "KINGMINOS_OPENAPI_INVENTORY";
export const OPENAPI_JSON_URL_ENV = "KINGMINOS_OPENAPI_JSON_URL";
export const OPENAPI_LIVE_ENV = "KINGMINOS_OPENAPI_LIVE";

export function defaultInventoryPath(cwd: string = process.cwd()): string {
  return resolve(cwd, DEFAULT_INVENTORY_RELATIVE);
}

/**
 * Same rule as kingminos-application `mcpToolFromOperationId`: every capital
 * after the first character starts a word, so `companyXAccount` is
 * `company_x_account` (not `company_xaccount`) in both repos.
 */
export function toolNameFromOperationId(operationId: string): string {
  return operationId
    .replace(/\./g, "_")
    .replace(/[A-Z]/g, (ch, index: number) => (index === 0 ? ch : `_${ch}`))
    .toLowerCase();
}

export function normalizePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, "{}");
}

export function surfaceKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

export function isPublicNonToolPath(
  path: string,
  extras: readonly string[] = [],
): boolean {
  if (extras.includes(path)) {
    return true;
  }
  if (path === "/health") {
    return true;
  }
  return /\/openapi\.(json|yaml)$/.test(path);
}

export function isExcludedPath(
  path: string,
  prefixes: readonly string[] = [],
): boolean {
  return prefixes.some((prefix) => {
    const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return path === normalized || path.startsWith(`${normalized}/`);
  });
}

export function surfacesAligned(diff: SurfaceDiff): boolean {
  return (
    diff.missingTools.length === 0 &&
    diff.extraTools.length === 0 &&
    diff.missingRoutes.length === 0 &&
    diff.extraRoutes.length === 0
  );
}

export function providersAligned(diff: ProviderDiff): boolean {
  return (
    diff.missingProviderNames.length === 0 &&
    diff.extraProviderNames.length === 0 &&
    diff.missingCredentialProviders.length === 0 &&
    diff.extraCredentialProviders.length === 0
  );
}

export function formatSurfaceDiff(diff: SurfaceDiff, source: string): string {
  return [
    "KingMinos MCP tools drifted from the OpenAPI inventory.",
    `source: ${source}`,
    diff.missingTools.length > 0
      ? `missing tools: ${diff.missingTools.join(", ")}`
      : "",
    diff.extraTools.length > 0
      ? `extra tools: ${diff.extraTools.join(", ")}`
      : "",
    diff.missingRoutes.length > 0
      ? `missing routes: ${diff.missingRoutes.join(", ")}`
      : "",
    diff.extraRoutes.length > 0
      ? `extra routes: ${diff.extraRoutes.join(", ")}`
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function formatProviderDiff(diff: ProviderDiff, source: string): string {
  return [
    "KingMinos MCP provider enums drifted from the OpenAPI inventory.",
    `source: ${source}`,
    diff.missingProviderNames.length > 0
      ? `missing ProviderName values: ${diff.missingProviderNames.join(", ")}`
      : "",
    diff.extraProviderNames.length > 0
      ? `extra ProviderName values: ${diff.extraProviderNames.join(", ")}`
      : "",
    diff.missingCredentialProviders.length > 0
      ? `missing CredentialProvider values: ${diff.missingCredentialProviders.join(", ")}`
      : "",
    diff.extraCredentialProviders.length > 0
      ? `extra CredentialProvider values: ${diff.extraCredentialProviders.join(", ")}`
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function diffSurfaces(
  advertised: readonly SurfaceOperation[],
  expected: readonly SurfaceOperation[],
): SurfaceDiff {
  const advertisedTools = new Set(
    advertised.map((op) => toolNameFromOperationId(op.operationId)),
  );
  const expectedTools = new Set(
    expected.map((op) => toolNameFromOperationId(op.operationId)),
  );
  const advertisedRoutes = new Set(
    advertised.map((op) => surfaceKey(op.method, op.path)),
  );
  const expectedRoutes = new Set(
    expected.map((op) => surfaceKey(op.method, op.path)),
  );

  return {
    missingTools: [...expectedTools]
      .filter((name) => !advertisedTools.has(name))
      .sort(),
    extraTools: [...advertisedTools]
      .filter((name) => !expectedTools.has(name))
      .sort(),
    missingRoutes: [...expectedRoutes]
      .filter((key) => !advertisedRoutes.has(key))
      .sort(),
    extraRoutes: [...advertisedRoutes]
      .filter((key) => !expectedRoutes.has(key))
      .sort(),
  };
}

function missingValues(
  advertised: readonly string[],
  expected: readonly string[],
): string[] {
  const have = new Set(advertised);
  return [...new Set(expected)].filter((value) => !have.has(value)).sort();
}

function extraValues(
  advertised: readonly string[],
  expected: readonly string[],
): string[] {
  const want = new Set(expected);
  return [...new Set(advertised)].filter((value) => !want.has(value)).sort();
}

export function diffProviders(
  advertised: ProviderLists,
  expected: ProviderLists,
  options: { ignoreExtraAdvertised?: boolean } = {},
): ProviderDiff {
  return {
    missingProviderNames: missingValues(
      advertised.providers,
      expected.providers,
    ),
    extraProviderNames: options.ignoreExtraAdvertised
      ? []
      : extraValues(advertised.providers, expected.providers),
    missingCredentialProviders: missingValues(
      advertised.credentialProviders,
      expected.credentialProviders,
    ),
    extraCredentialProviders: options.ignoreExtraAdvertised
      ? []
      : extraValues(
          advertised.credentialProviders,
          expected.credentialProviders,
        ),
  };
}

export function unionPreserve(
  base: readonly string[],
  extra: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...base, ...extra]) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function mergeOperations(
  existing: readonly SurfaceOperation[],
  live: readonly SurfaceOperation[],
): SurfaceOperation[] {
  const liveByKey = new Map(
    live.map((op) => [surfaceKey(op.method, op.path), op]),
  );
  const out: SurfaceOperation[] = [];
  const seen = new Set<string>();
  for (const op of existing) {
    const key = surfaceKey(op.method, op.path);
    const updated = liveByKey.get(key);
    if (!updated) {
      continue;
    }
    out.push(updated);
    seen.add(key);
  }
  for (const op of live) {
    const key = surfaceKey(op.method, op.path);
    if (seen.has(key)) {
      continue;
    }
    out.push(op);
  }
  return out;
}

function asHttpMethod(value: string): HttpMethod {
  const method = value.toUpperCase();
  if (method === "GET") return "GET";
  if (method === "POST") return "POST";
  if (method === "PUT") return "PUT";
  if (method === "PATCH") return "PATCH";
  if (method === "DELETE") return "DELETE";
  throw new Error(`Unsupported HTTP method in inventory: ${value}`);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function capabilityProvidersMap(
  value: unknown,
): Record<string, string[]> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, string[]> = {};
  for (const [capability, providers] of Object.entries(value)) {
    const list = stringList(providers);
    if (list.length > 0) {
      out[capability] = list;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isPathList(
  options: InventoryParseOptions | readonly string[],
): options is readonly string[] {
  return Array.isArray(options);
}

function normalizeParseOptions(
  options: InventoryParseOptions | readonly string[] = {},
): Required<InventoryParseOptions> {
  if (isPathList(options)) {
    return {
      publicNonToolPaths: options,
      nonToolPathPrefixes: [],
      excludedOperationIds: [],
    };
  }
  return {
    publicNonToolPaths: options.publicNonToolPaths ?? [],
    nonToolPathPrefixes: options.nonToolPathPrefixes ?? [],
    excludedOperationIds: options.excludedOperationIds ?? [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function operationHasBearerSecurity(
  operation: unknown,
  document: unknown,
): boolean {
  if (!isRecord(operation)) {
    return false;
  }
  const inherited = isRecord(document) ? document.security : undefined;
  const security =
    operation.security !== undefined ? operation.security : inherited;
  if (!Array.isArray(security)) {
    return false;
  }
  return security.some(
    (entry) => isRecord(entry) && Object.hasOwn(entry, BEARER_SCHEME),
  );
}

export function parseInventoryDocument(
  raw: unknown,
  source: string,
): OpenApiInventory {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} must be an object with operations[]`);
  }
  const record = raw as Record<string, unknown>;
  const publicNonToolPaths = stringList(record.publicNonToolPaths);
  const nonToolPathPrefixes = stringList(record.nonToolPathPrefixes);
  const excludedOperationIds = stringList(record.excludedOperationIds);
  if (!Array.isArray(record.operations)) {
    throw new Error(`${source} is missing operations[]`);
  }

  const operations: SurfaceOperation[] = record.operations.map(
    (item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new Error(`${source} operations[${index}] must be an object`);
      }
      const op = item as Record<string, unknown>;
      if (typeof op.operationId !== "string" || op.operationId.length === 0) {
        throw new Error(
          `${source} operations[${index}] is missing operationId`,
        );
      }
      if (typeof op.method !== "string") {
        throw new Error(`${source} operations[${index}] is missing method`);
      }
      if (typeof op.path !== "string" || !op.path.startsWith("/")) {
        throw new Error(`${source} operations[${index}] is missing a path`);
      }
      return {
        operationId: op.operationId,
        method: asHttpMethod(op.method),
        path: op.path,
      };
    },
  );

  return {
    publicNonToolPaths,
    nonToolPathPrefixes,
    excludedOperationIds,
    providers: stringList(record.providers),
    credentialProviders: stringList(record.credentialProviders),
    capabilityProviders: capabilityProvidersMap(record.capabilityProviders),
    operations,
  };
}

export function readInventoryFile(filePath: string): OpenApiInventory {
  const absolute = isAbsolute(filePath)
    ? filePath
    : resolve(process.cwd(), filePath);
  const parsed: unknown = JSON.parse(readFileSync(absolute, "utf8"));
  return parseInventoryDocument(parsed, absolute);
}

export function inventoryFromOpenApiDocument(
  doc: unknown,
  publicNonToolPathsOrOptions: InventoryParseOptions | readonly string[] = [],
): OpenApiInventory | { reason: string } {
  if (typeof doc !== "object" || doc === null || !("paths" in doc)) {
    return { reason: "not an OpenAPI document (missing paths)" };
  }
  const options = normalizeParseOptions(publicNonToolPathsOrOptions);
  const paths = (doc as { paths?: unknown }).paths;
  if (typeof paths !== "object" || paths === null) {
    return { reason: "OpenAPI paths is not an object" };
  }

  const resourceOps: Array<
    SurfaceOperation | { path: string; method: string }
  > = [];
  for (const [path, methods] of Object.entries(
    paths as Record<string, unknown>,
  )) {
    if (isPublicNonToolPath(path, options.publicNonToolPaths)) {
      continue;
    }
    if (isExcludedPath(path, options.nonToolPathPrefixes)) {
      continue;
    }
    if (typeof methods !== "object" || methods === null) {
      continue;
    }
    for (const [method, op] of Object.entries(
      methods as Record<string, unknown>,
    )) {
      if (!HTTP_METHODS.has(method.toUpperCase())) {
        continue;
      }
      if (typeof op !== "object" || op === null) {
        continue;
      }
      if (!operationHasBearerSecurity(op, doc)) {
        continue;
      }
      const operationId = (op as { operationId?: unknown }).operationId;
      if (
        typeof operationId === "string" &&
        options.excludedOperationIds.includes(operationId)
      ) {
        continue;
      }
      if (typeof operationId === "string" && operationId.length > 0) {
        resourceOps.push({
          operationId,
          method: asHttpMethod(method),
          path,
        });
      } else {
        resourceOps.push({ method: method.toUpperCase(), path });
      }
    }
  }

  const withIds = resourceOps.filter(
    (op): op is SurfaceOperation => "operationId" in op,
  );
  if (withIds.length === 0) {
    return { reason: "no bearer-authenticated resource operations" };
  }
  if (withIds.length !== resourceOps.length) {
    const missing = resourceOps
      .filter((op) => !("operationId" in op))
      .map((op) => `${op.method} ${op.path}`);
    return {
      reason: `resource operations missing operationId: ${missing.join(", ")}`,
    };
  }

  const extracted = providersFromOpenApiDocument(doc);
  return {
    publicNonToolPaths: [...options.publicNonToolPaths],
    nonToolPathPrefixes: [...options.nonToolPathPrefixes],
    excludedOperationIds: [...options.excludedOperationIds],
    providers: extracted.providers,
    credentialProviders: extracted.credentialProviders,
    operations: withIds,
  };
}

function schemaMap(doc: unknown): Record<string, unknown> | undefined {
  if (!isRecord(doc) || !isRecord(doc.components)) {
    return undefined;
  }
  if (!isRecord(doc.components.schemas)) {
    return undefined;
  }
  return doc.components.schemas;
}

function stringEnumValues(schema: unknown): string[] {
  if (!isRecord(schema) || !Array.isArray(schema.enum)) {
    return [];
  }
  return schema.enum.filter((item): item is string => typeof item === "string");
}

function schemaEnum(doc: unknown, schemaName: string): string[] {
  const schemas = schemaMap(doc);
  return schemas ? stringEnumValues(schemas[schemaName]) : [];
}

function schemaPropertyEnum(
  doc: unknown,
  schemaName: string,
  propertyName: string,
): string[] {
  const schemas = schemaMap(doc);
  const schema = schemas?.[schemaName];
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  return stringEnumValues(schema.properties[propertyName]);
}

function pathParameterEnum(
  doc: unknown,
  path: string,
  paramName: string,
): string[] {
  if (!isRecord(doc) || !isRecord(doc.paths) || !isRecord(doc.paths[path])) {
    return [];
  }
  const item = doc.paths[path];
  const params = Array.isArray(item.parameters) ? item.parameters : [];
  for (const param of params) {
    if (!isRecord(param) || param.name !== paramName) {
      continue;
    }
    const values = stringEnumValues(param.schema);
    if (values.length > 0) {
      return values;
    }
  }
  return [];
}

/**
 * Credential-only BYOK vendors: the application descriptor has `operations: {}`
 * (Your Keys store/verify only, no routing hop), so routing.only rejects them.
 * They stay in credentialProviders[] but never land in providers[].
 */
export const CREDENTIAL_ONLY_PROVIDERS: readonly string[] = [
  "snovio",
  "cognism",
  "lusha",
  "starbridge",
  "clay",
  "databar",
  "quickenrich",
  "getleads",
  "blitzapi",
];

export function routableProviders(names: readonly string[]): string[] {
  const skip = new Set(CREDENTIAL_ONLY_PROVIDERS);
  return names.filter((name) => !skip.has(name));
}

export function providersFromOpenApiDocument(doc: unknown): ProviderLists {
  return {
    providers: routableProviders(schemaEnum(doc, "ProviderName")),
    credentialProviders: unionPreserve(
      pathParameterEnum(doc, CREDENTIALS_PROVIDER_PATH, "provider"),
      unionPreserve(
        schemaPropertyEnum(doc, "CredentialStoreResponse", "provider"),
        schemaPropertyEnum(doc, "CredentialRevokeResponse", "provider"),
      ),
    ),
  };
}

export function excludedOperationIdsFromOpenApiDocument(
  doc: unknown,
  prefixes: readonly string[],
): string[] {
  if (!isRecord(doc) || !isRecord(doc.paths)) {
    return [];
  }
  const ids: string[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    if (!isExcludedPath(path, prefixes) || !isRecord(methods)) {
      continue;
    }
    for (const [method, op] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method.toUpperCase()) || !isRecord(op)) {
        continue;
      }
      if (typeof op.operationId === "string" && op.operationId.length > 0) {
        ids.push(op.operationId);
      }
    }
  }
  return unionPreserve([], ids);
}

export function serializeInventoryFile(inventory: OpenApiInventory): string {
  return `${JSON.stringify(
    {
      source: INVENTORY_SOURCE_BLURB,
      spec: INVENTORY_SPEC_URL,
      liveOpenApiJson: INVENTORY_LIVE_OPENAPI_JSON_URL,
      exclusionPolicy: INVENTORY_EXCLUSION_POLICY,
      providersPolicy: INVENTORY_PROVIDERS_POLICY,
      publicNonToolPaths: inventory.publicNonToolPaths,
      nonToolPathPrefixes: inventory.nonToolPathPrefixes,
      excludedOperationIds: inventory.excludedOperationIds,
      providers: inventory.providers,
      credentialProviders: inventory.credentialProviders,
      ...(inventory.capabilityProviders
        ? { capabilityProviders: inventory.capabilityProviders }
        : {}),
      operations: inventory.operations,
    },
    null,
    2,
  )}\n`;
}

export function writeInventoryFile(
  filePath: string,
  inventory: OpenApiInventory,
): void {
  const absolute = isAbsolute(filePath)
    ? filePath
    : resolve(process.cwd(), filePath);
  writeFileSync(absolute, serializeInventoryFile(inventory));
}

async function fetchJson(url: string): Promise<unknown | undefined> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(OPENAPI_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json") && !contentType.includes("text/plain")) {
      return undefined;
    }
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export async function tryLoadLiveOpenApiJson(
  baseUrl: string = apiBaseUrl(),
  publicNonToolPathsOrOptions: InventoryParseOptions | readonly string[] = [],
): Promise<ResolvedInventory | undefined> {
  const options = normalizeParseOptions(publicNonToolPathsOrOptions);
  const override = process.env[OPENAPI_JSON_URL_ENV]?.trim();
  const urls = override
    ? [override]
    : LIVE_OPENAPI_JSON_PATHS.map((path) => `${baseUrl}${path}`);

  for (const url of urls) {
    const doc = await fetchJson(url);
    if (doc === undefined) {
      continue;
    }
    const parsed = inventoryFromOpenApiDocument(doc, options);
    if ("reason" in parsed) {
      continue;
    }
    return { source: url, inventory: parsed };
  }
  return undefined;
}

/** Deterministic file inventory. Never hits the network. */
export async function resolveExpectedInventory(
  cwd: string = process.cwd(),
): Promise<ResolvedInventory> {
  const overridePath = process.env[INVENTORY_PATH_ENV]?.trim();
  const filePath = overridePath || defaultInventoryPath(cwd);
  return { source: filePath, inventory: readInventoryFile(filePath) };
}

/** Live OpenAPI spec. Fails when the document cannot be loaded or parsed. */
export async function resolveLiveInventory(
  cwd: string = process.cwd(),
): Promise<ResolvedInventory> {
  const filePath = defaultInventoryPath(cwd);
  const fileInventory = readInventoryFile(filePath);
  const live = await tryLoadLiveOpenApiJson(apiBaseUrl(), {
    publicNonToolPaths: fileInventory.publicNonToolPaths,
    nonToolPathPrefixes: fileInventory.nonToolPathPrefixes,
    excludedOperationIds: fileInventory.excludedOperationIds,
  });
  if (!live) {
    throw new Error(
      `Failed to load live OpenAPI spec. Set ${OPENAPI_JSON_URL_ENV} or serve ${apiBaseUrl()}/openapi.json.`,
    );
  }
  return live;
}

export async function fetchLiveOpenApiDocument(
  baseUrl: string = apiBaseUrl(),
): Promise<{ source: string; document: unknown }> {
  const override = process.env[OPENAPI_JSON_URL_ENV]?.trim();
  const urls = override
    ? [override]
    : LIVE_OPENAPI_JSON_PATHS.map((path) => `${baseUrl}${path}`);

  for (const url of urls) {
    const doc = await fetchJson(url);
    if (doc === undefined) {
      continue;
    }
    if (typeof doc === "object" && doc !== null && "paths" in doc) {
      return { source: url, document: doc };
    }
  }
  throw new Error(
    `Failed to load live OpenAPI spec. Set ${OPENAPI_JSON_URL_ENV} or serve ${baseUrl}/openapi.json.`,
  );
}

export interface RefreshInventoryResult {
  path: string;
  source: string;
  inventory: OpenApiInventory;
}

/**
 * Rewrite the pinned inventory from live OpenAPI.
 * Bearer resource operations replace operations[]. Provider enums and
 * excludedOperationIds are unioned with the existing pin so a stale
 * production spec cannot drop names (e.g. prospeo). Credential-only vendors
 * are kept out of providers[]; capabilityProviders is preserved verbatim.
 */
export async function refreshInventoryFile(
  cwd: string = process.cwd(),
): Promise<RefreshInventoryResult> {
  const overridePath = process.env[INVENTORY_PATH_ENV]?.trim();
  const filePath = overridePath || defaultInventoryPath(cwd);
  const existing = readInventoryFile(filePath);
  const live = await fetchLiveOpenApiDocument();
  const parsed = inventoryFromOpenApiDocument(live.document, {
    publicNonToolPaths: existing.publicNonToolPaths,
    nonToolPathPrefixes: existing.nonToolPathPrefixes,
    excludedOperationIds: existing.excludedOperationIds,
  });
  if ("reason" in parsed) {
    throw new Error(
      `Live OpenAPI could not be converted to an inventory: ${parsed.reason}`,
    );
  }

  const liveProviders = providersFromOpenApiDocument(live.document);
  const liveExcluded = excludedOperationIdsFromOpenApiDocument(
    live.document,
    existing.nonToolPathPrefixes,
  );
  const inventory: OpenApiInventory = {
    publicNonToolPaths: existing.publicNonToolPaths,
    nonToolPathPrefixes: existing.nonToolPathPrefixes,
    excludedOperationIds: unionPreserve(
      existing.excludedOperationIds,
      liveExcluded,
    ),
    providers: routableProviders(
      unionPreserve(existing.providers, liveProviders.providers),
    ),
    credentialProviders: unionPreserve(
      existing.credentialProviders,
      liveProviders.credentialProviders,
    ),
    // Hand-written pin; live OpenAPI has no source for it.
    ...(existing.capabilityProviders
      ? { capabilityProviders: existing.capabilityProviders }
      : {}),
    operations: mergeOperations(
      existing.operations,
      parsed.operations.map((op) => ({
        ...op,
        operationId: toolNameFromOperationId(op.operationId),
      })),
    ),
  };
  writeInventoryFile(filePath, inventory);
  return { path: filePath, source: live.source, inventory };
}
