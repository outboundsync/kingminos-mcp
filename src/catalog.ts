export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type ToolName =
  | "get_providers"
  | "get_capabilities"
  | "resolve_company"
  | "decide_company_domain"
  | "decide_company_hierarchy"
  | "verify_employment"
  | "get_run"
  | "put_credential"
  | "delete_credential"
  | "erase_subject";

export interface ResourceRoute {
  method: HttpMethod;
  path: string;
  tool: ToolName;
}

/**
 * Authenticated live KingMinos resource routes from GET /openapi.yaml.
 * Public docs/health paths are not tools (same split as OutboundSync MCP).
 */
export const LIVE_RESOURCE_ROUTES: readonly ResourceRoute[] = [
  { method: "GET", path: "/v1/providers", tool: "get_providers" },
  { method: "GET", path: "/v1/capabilities", tool: "get_capabilities" },
  { method: "POST", path: "/v1/company/hierarchy", tool: "decide_company_hierarchy" },
  { method: "POST", path: "/v1/company/domain", tool: "decide_company_domain" },
  { method: "POST", path: "/v1/company/resolve", tool: "resolve_company" },
  { method: "POST", path: "/v1/person/verify-employment", tool: "verify_employment" },
  { method: "GET", path: "/v1/runs/{id}", tool: "get_run" },
  { method: "PUT", path: "/v1/credentials/{provider}", tool: "put_credential" },
  { method: "DELETE", path: "/v1/credentials/{provider}", tool: "delete_credential" },
  { method: "DELETE", path: "/v1/subjects/{subject_key}", tool: "erase_subject" },
] as const;

export const PUBLIC_NON_TOOL_PATHS = [
  "/health",
  "/openapi.yaml",
  "/v1/openapi.yaml",
] as const;

export const TOOL_NAMES: readonly ToolName[] = LIVE_RESOURCE_ROUTES.map(
  (route) => route.tool,
);

export function toolsForLiveApi(): ToolName[] {
  return [...TOOL_NAMES];
}
