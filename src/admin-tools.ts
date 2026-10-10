import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolErrorResult } from "./errors.js";
import { apiRequest, okText } from "./kingminos-client.js";

/**
 * Admin-only tools (Harris 2026-10-10). Registered ONLY when the MCP bearer is
 * a KingMinos admin token (`kmadm_…`, stored as a hash in the API's D1 and
 * minted by Harris). Normal tenant/user bearers never see them in tools/list;
 * the API re-checks the token on every call (403 otherwise).
 */
export const ADMIN_TOKEN_PREFIX = "kmadm_";
export const ADMIN_TOOL_NAMES = [
  "abuse_report",
  "partner_report",
  "partner_payout",
] as const;

export function isAdminBearer(bearer: string | undefined): boolean {
  return (
    typeof bearer === "string" &&
    bearer.startsWith(ADMIN_TOKEN_PREFIX) &&
    bearer.length > ADMIN_TOKEN_PREFIX.length
  );
}

export function registerAdminTools(
  server: McpServer,
  bearer: string,
  baseUrl?: string,
): void {
  const call = async (
    method: "GET" | "POST",
    path: string,
    query: Record<string, string | undefined>,
    body: unknown,
    signal?: AbortSignal,
  ) => {
    try {
      return okText(
        await apiRequest({
          method,
          path,
          bearer,
          query,
          body,
          signal,
          baseUrl,
        }),
      );
    } catch (error) {
      return toolErrorResult(error);
    }
  };

  server.registerTool(
    "abuse_report",
    {
      description:
        "Admin only. Daily KingMinos abuse report from D1 (GET /v1/admin/abuse/daily): signups (verified/unverified, work/personal), rejects (disposable, login send-limit, signup-limited), grants issued and held, free credits burned (total + top 10 workspaces), premium-cap hits, accounts flagged, Stripe refunds/chargebacks, anomalies (>3 signups per network/IP, day-one >80% free burn, repeat rejects). UTC day; default today. Traffic/country/ASN/Turnstile live in Cloudflare (links in `cloudflare`). format=csv returns metric,value rows.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("UTC day YYYY-MM-DD; default today"),
        format: z.enum(["json", "csv"]).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) =>
      call(
        "GET",
        "/v1/admin/abuse/daily",
        { date: args.date, format: args.format === "csv" ? "csv" : undefined },
        undefined,
        extra.signal,
      ),
  );

  server.registerTool(
    "partner_report",
    {
      description:
        "Admin only. Partner program analytics from D1 (GET /v1/admin/partners/analytics): per partner codes redeemed, new workspaces, first-purchase conversion, bonus credits granted, payments/refunds/net revenue (cents), 20% commission earned / paid / due (payout_due at $100), top 5 customers, and a 6-month or 8-week trend. period=month (month=YYYY-MM, default current) or period=week (week_start=YYYY-MM-DD Monday, default this week). format=csv for a sheet.",
      inputSchema: {
        period: z.enum(["month", "week"]).optional(),
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        week_start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        format: z.enum(["json", "csv"]).optional(),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) =>
      call(
        "GET",
        "/v1/admin/partners/analytics",
        {
          period: args.period ?? "month",
          month: args.month,
          week_start: args.week_start,
          format: args.format === "csv" ? "csv" : undefined,
        },
        undefined,
        extra.signal,
      ),
  );

  server.registerTool(
    "partner_payout",
    {
      description:
        "Admin only. Records a partner commission payout (POST /v1/admin/partners/payouts). method=cash records a PayPal/Wise/manual transfer you already made; method=credits also grants amount × 12.5 bundle credits ($100 = 1,250) to workspace_id with the memo on the ledger. `id` is the idempotency key (same id = no second payout). Moves value: confirm partner, amount and method with the user first, and check partner_report commission_due_cents.",
      inputSchema: {
        id: z
          .string()
          .regex(/^[A-Za-z0-9_:.-]{3,80}$/)
          .describe("Idempotency key, e.g. po_p_acme_2026-10"),
        partner_id: z.string().min(1),
        amount_cents: z.number().int().positive(),
        method: z.enum(["cash", "credits"]),
        workspace_id: z
          .string()
          .optional()
          .describe("Required for method=credits"),
        memo: z.string().min(1).max(200),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) =>
      call("POST", "/v1/admin/partners/payouts", {}, args, extra.signal),
  );
}
