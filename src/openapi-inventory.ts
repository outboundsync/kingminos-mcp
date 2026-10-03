import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { apiBaseUrl } from "./config.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SurfaceOperation {
  operationId: string;
  method: HttpMethod;
  path: string;
}

export interface OpenApiInventory {
  publicNonToolPaths: string[];
  operations: SurfaceOperation[];
}

export interface SurfaceDiff {
  missingTools: string[];
  extraTools: string[];
  missingRoutes: string[];
  extraRoutes: string[];
}

export interface ResolvedInventory {
  source: string;
  inventory: OpenApiInventory;
}

const HTTP_METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_INVENTORY_RELATIVE = "inventory/openapi-surfaces.json";
const LIVE_OPENAPI_JSON_PATHS = ["/openapi.json", "/v1/openapi.json"] as const;

export const INVENTORY_PATH_ENV = "KINGMINOS_OPENAPI_INVENTORY";
export const OPENAPI_JSON_URL_ENV = "KINGMINOS_OPENAPI_JSON_URL";

export function defaultInventoryPath(cwd: string = process.cwd()): string {
  return resolve(cwd, DEFAULT_INVENTORY_RELATIVE);
}

export function toolNameFromOperationId(operationId: string): string {
  return operationId
    .replace(/\./g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
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

export function surfacesAligned(diff: SurfaceDiff): boolean {
  return (
    diff.missingTools.length === 0 &&
    diff.extraTools.length === 0 &&
    diff.missingRoutes.length === 0 &&
    diff.extraRoutes.length === 0
  );
}

export function formatSurfaceDiff(diff: SurfaceDiff, source: string): string {
  return [
    "KingMinos MCP tools drifted from the OpenAPI inventory.",
    `source: ${source}`,
    diff.missingTools.length > 0
      ? `missing tools: ${diff.missingTools.join(", ")}`
      : "",
    diff.extraTools.length > 0 ? `extra tools: ${diff.extraTools.join(", ")}` : "",
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

function asHttpMethod(value: string): HttpMethod {
  const method = value.toUpperCase();
  if (method === "GET") return "GET";
  if (method === "POST") return "POST";
  if (method === "PUT") return "PUT";
  if (method === "PATCH") return "PATCH";
  if (method === "DELETE") return "DELETE";
  throw new Error(`Unsupported HTTP method in inventory: ${value}`);
}

export function parseInventoryDocument(raw: unknown, source: string): OpenApiInventory {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source} must be an object with operations[]`);
  }
  const record = raw as Record<string, unknown>;
  const publicNonToolPaths = Array.isArray(record.publicNonToolPaths)
    ? record.publicNonToolPaths.filter((path): path is string => typeof path === "string")
    : [];
  if (!Array.isArray(record.operations)) {
    throw new Error(`${source} is missing operations[]`);
  }

  const operations: SurfaceOperation[] = record.operations.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`${source} operations[${index}] must be an object`);
    }
    const op = item as Record<string, unknown>;
    if (typeof op.operationId !== "string" || op.operationId.length === 0) {
      throw new Error(`${source} operations[${index}] is missing operationId`);
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
  });

  return { publicNonToolPaths, operations };
}

export function readInventoryFile(filePath: string): OpenApiInventory {
  const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  const parsed: unknown = JSON.parse(readFileSync(absolute, "utf8"));
  return parseInventoryDocument(parsed, absolute);
}

export function inventoryFromOpenApiDocument(
  doc: unknown,
  publicNonToolPaths: readonly string[] = [],
): OpenApiInventory | { reason: string } {
  if (typeof doc !== "object" || doc === null || !("paths" in doc)) {
    return { reason: "not an OpenAPI document (missing paths)" };
  }
  const paths = (doc as { paths?: unknown }).paths;
  if (typeof paths !== "object" || paths === null) {
    return { reason: "OpenAPI paths is not an object" };
  }

  const resourceOps: Array<SurfaceOperation | { path: string; method: string }> = [];
  for (const [path, methods] of Object.entries(paths as Record<string, unknown>)) {
    if (isPublicNonToolPath(path, publicNonToolPaths)) {
      continue;
    }
    if (typeof methods !== "object" || methods === null) {
      continue;
    }
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      if (!HTTP_METHODS.has(method.toUpperCase())) {
        continue;
      }
      if (typeof op !== "object" || op === null) {
        continue;
      }
      const operationId = (op as { operationId?: unknown }).operationId;
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
    return { reason: "resource operations have no operationId" };
  }
  if (withIds.length !== resourceOps.length) {
    const missing = resourceOps
      .filter((op) => !("operationId" in op))
      .map((op) => `${op.method} ${op.path}`);
    return {
      reason: `resource operations missing operationId: ${missing.join(", ")}`,
    };
  }

  return {
    publicNonToolPaths: [...publicNonToolPaths],
    operations: withIds,
  };
}

async function fetchJson(url: string): Promise<unknown | undefined> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return undefined;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json") && !contentType.includes("text/plain")) {
    return undefined;
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export async function tryLoadLiveOpenApiJson(
  baseUrl: string = apiBaseUrl(),
  publicNonToolPaths: readonly string[] = [],
): Promise<ResolvedInventory | undefined> {
  const override = process.env[OPENAPI_JSON_URL_ENV]?.trim();
  const urls = override
    ? [override]
    : LIVE_OPENAPI_JSON_PATHS.map((path) => `${baseUrl}${path}`);

  for (const url of urls) {
    const doc = await fetchJson(url);
    if (doc === undefined) {
      continue;
    }
    const parsed = inventoryFromOpenApiDocument(doc, publicNonToolPaths);
    if ("reason" in parsed) {
      continue;
    }
    return { source: url, inventory: parsed };
  }
  return undefined;
}

export async function resolveExpectedInventory(
  cwd: string = process.cwd(),
): Promise<ResolvedInventory> {
  const overridePath = process.env[INVENTORY_PATH_ENV]?.trim();
  if (overridePath) {
    return { source: overridePath, inventory: readInventoryFile(overridePath) };
  }

  const filePath = defaultInventoryPath(cwd);
  const fileInventory = readInventoryFile(filePath);
  const live = await tryLoadLiveOpenApiJson(
    apiBaseUrl(),
    fileInventory.publicNonToolPaths,
  );
  if (live) {
    return live;
  }
  return { source: filePath, inventory: fileInventory };
}
