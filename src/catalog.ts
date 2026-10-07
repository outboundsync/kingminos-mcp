import type { HttpMethod, SurfaceOperation } from "./openapi-inventory.js";

export type ToolName =
  | "get_providers"
  | "get_capabilities"
  | "company_resolve"
  | "company_domain"
  | "company_hierarchy"
  | "company_b2b_social"
  | "person_verify_employment"
  | "get_run"
  | "list_credentials"
  | "put_credentials"
  | "delete_credentials"
  | "delete_subject";

export interface ResourceRoute {
  method: HttpMethod;
  path: string;
  tool: ToolName;
}

/**
 * One MCP tool per bearer-authenticated KingMinos resource operationId (snake_case).
 * Session/cookie routes under /v1/auth/* and /v1/account/* are not tools.
 */
export const LIVE_RESOURCE_ROUTES: readonly ResourceRoute[] = [
  { method: "GET", path: "/v1/providers", tool: "get_providers" },
  { method: "GET", path: "/v1/capabilities", tool: "get_capabilities" },
  { method: "POST", path: "/v1/company/resolve", tool: "company_resolve" },
  { method: "POST", path: "/v1/company/domain", tool: "company_domain" },
  { method: "POST", path: "/v1/company/hierarchy", tool: "company_hierarchy" },
  {
    method: "POST",
    path: "/v1/company/b2b-social",
    tool: "company_b2b_social",
  },
  {
    method: "POST",
    path: "/v1/person/verify-employment",
    tool: "person_verify_employment",
  },
  { method: "GET", path: "/v1/runs/{id}", tool: "get_run" },
  { method: "GET", path: "/v1/credentials", tool: "list_credentials" },
  {
    method: "PUT",
    path: "/v1/credentials/{provider}",
    tool: "put_credentials",
  },
  {
    method: "DELETE",
    path: "/v1/credentials/{provider}",
    tool: "delete_credentials",
  },
  {
    method: "DELETE",
    path: "/v1/subjects/{subject_key}",
    tool: "delete_subject",
  },
] as const;

export const TOOL_NAMES: readonly ToolName[] = LIVE_RESOURCE_ROUTES.map(
  (route) => route.tool,
);

export function advertisedOperations(): SurfaceOperation[] {
  return LIVE_RESOURCE_ROUTES.map((route) => ({
    operationId: route.tool,
    method: route.method,
    path: route.path,
  }));
}
