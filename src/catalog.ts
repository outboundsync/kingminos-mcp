import type { HttpMethod, SurfaceOperation } from "./openapi-inventory.js";

export type ToolName =
  | "get_providers"
  | "get_capabilities"
  | "get_recipes"
  | "get_balance"
  | "get_balance_ledger"
  | "get_balance_history"
  | "get_balance_forecast"
  | "get_balance_health"
  | "get_usage"
  | "company_resolve"
  | "company_domain"
  | "company_hierarchy"
  | "company_b2b_social"
  | "company_x_account"
  | "company_icon"
  | "company_description"
  | "person_verify_employment"
  | "person_language"
  | "person_phone"
  | "person_title"
  | "person_b2b_social"
  | "person_name"
  | "get_run"
  | "list_credentials"
  | "put_credentials"
  | "delete_credentials"
  | "delete_subject"
  | "list_webhooks"
  | "create_webhook"
  | "get_webhook"
  | "patch_webhook"
  | "delete_webhook"
  | "rotate_webhook_secret"
  | "test_webhook"
  | "list_webhook_deliveries"
  | "replay_webhook_delivery"
  | "list_events"
  | "submit_feedback";

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
  { method: "GET", path: "/v1/recipes", tool: "get_recipes" },
  { method: "GET", path: "/v1/balance", tool: "get_balance" },
  { method: "GET", path: "/v1/balance/ledger", tool: "get_balance_ledger" },
  { method: "GET", path: "/v1/balance/history", tool: "get_balance_history" },
  { method: "GET", path: "/v1/balance/forecast", tool: "get_balance_forecast" },
  { method: "GET", path: "/v1/balance/health", tool: "get_balance_health" },
  { method: "GET", path: "/v1/usage", tool: "get_usage" },
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
    path: "/v1/company/x-account",
    tool: "company_x_account",
  },
  {
    method: "POST",
    path: "/v1/company/icon",
    tool: "company_icon",
  },
  {
    method: "POST",
    path: "/v1/company/description",
    tool: "company_description",
  },
  {
    method: "POST",
    path: "/v1/person/verify-employment",
    tool: "person_verify_employment",
  },
  {
    method: "POST",
    path: "/v1/person/language",
    tool: "person_language",
  },
  {
    method: "POST",
    path: "/v1/person/phone",
    tool: "person_phone",
  },
  {
    method: "POST",
    path: "/v1/person/title",
    tool: "person_title",
  },
  {
    method: "POST",
    path: "/v1/person/b2b-social",
    tool: "person_b2b_social",
  },
  {
    method: "POST",
    path: "/v1/person/name",
    tool: "person_name",
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
  { method: "GET", path: "/v1/webhooks", tool: "list_webhooks" },
  { method: "POST", path: "/v1/webhooks", tool: "create_webhook" },
  { method: "GET", path: "/v1/webhooks/{id}", tool: "get_webhook" },
  { method: "PATCH", path: "/v1/webhooks/{id}", tool: "patch_webhook" },
  { method: "DELETE", path: "/v1/webhooks/{id}", tool: "delete_webhook" },
  {
    method: "POST",
    path: "/v1/webhooks/{id}/rotate-secret",
    tool: "rotate_webhook_secret",
  },
  { method: "POST", path: "/v1/webhooks/{id}/test", tool: "test_webhook" },
  {
    method: "GET",
    path: "/v1/webhooks/{id}/deliveries",
    tool: "list_webhook_deliveries",
  },
  {
    method: "POST",
    path: "/v1/webhooks/{id}/deliveries/{delivery_id}/replay",
    tool: "replay_webhook_delivery",
  },
  { method: "GET", path: "/v1/events", tool: "list_events" },
  { method: "POST", path: "/v1/feedback", tool: "submit_feedback" },
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
