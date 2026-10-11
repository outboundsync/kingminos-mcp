import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolErrorResult } from "./errors.js";
import { apiRequest, okText } from "./kingminos-client.js";
import { FEEDBACK_CATEGORY_VALUES } from "./schemas.js";

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
  "feedback_report",
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
        "Admin only. Partner payouts. action=list_pending: payouts waiting for approval (created on the 1st for partners owed >= $100 after a 30-day hold), with Stripe readiness (GET /v1/admin/partners/payouts?status=pending). action=approve: approve AND PAY one payout by id. Sends a Stripe Connect transfer to the partner's account (idempotency key = payout id), or grants credits if they chose credits (POST /v1/admin/partners/payouts/{id}/approve). Payouts over $2,000 need confirm = the exact amount, e.g. \"2500.00\". action=record: record a manual cash/credits payout already made (POST /v1/admin/partners/payouts). approve and record move money: get the user's explicit OK for the partner, amount and month first.",
      inputSchema: {
        action: z
          .enum(["list_pending", "approve", "record"])
          .optional()
          .describe("Default record (back-compat)"),
        id: z
          .string()
          .regex(/^[A-Za-z0-9_:.-]{3,120}$/)
          .optional()
          .describe("Payout id (approve) or idempotency key (record)"),
        confirm: z
          .string()
          .optional()
          .describe("approve over $2,000: the exact amount, e.g. 2500.00"),
        partner_id: z.string().min(1).optional(),
        amount_cents: z.number().int().positive().optional(),
        method: z.enum(["cash", "credits"]).optional(),
        workspace_id: z
          .string()
          .optional()
          .describe("record with method=credits"),
        memo: z.string().min(1).max(200).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const action = args.action ?? "record";
      if (action === "list_pending") {
        return call(
          "GET",
          "/v1/admin/partners/payouts",
          { status: "pending" },
          undefined,
          extra.signal,
        );
      }
      if (action === "approve") {
        if (!args.id) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "approve needs id (from list_pending).",
              },
            ],
          };
        }
        return call(
          "POST",
          `/v1/admin/partners/payouts/${encodeURIComponent(args.id)}/approve`,
          {},
          { confirm: args.confirm },
          extra.signal,
        );
      }
      const { action: _a, confirm: _c, ...body } = args;
      return call("POST", "/v1/admin/partners/payouts", {}, body, extra.signal);
    },
  );

  server.registerTool(
    "feedback_report",
    {
      description:
        "Admin only. Feedback triage feed from D1 (GET /v1/admin/feedback/summary): groups of product feedback with counts and status breakdown, grouped by category + requested (provider/endpoint requests), category + capability (data_quality), or category + lower(summary). Returns count, latest summary, capability/requested, and linked run_ids — never the free-text details/task_context (PII); truncated: true when the window holds more than 5000 reports. format=list returns raw rows (GET /v1/admin/feedback, newest first, includes details) and is the only format that applies the category/status filters.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(0)
          .max(365)
          .optional()
          .describe("Window in days (default 30)."),
        category: z
          .enum(FEEDBACK_CATEGORY_VALUES)
          .optional()
          .describe("format=list only."),
        status: z
          .enum(["new", "triaged", "planned", "shipped", "wontfix"])
          .optional()
          .describe("format=list only."),
        format: z
          .enum(["summary", "list"])
          .optional()
          .describe("summary (grouped counts, default) or list (raw rows)."),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) => {
      if (args.format === "list") {
        return call(
          "GET",
          "/v1/admin/feedback",
          {
            status: args.status,
            category: args.category,
            days: args.days === undefined ? undefined : String(args.days),
          },
          undefined,
          extra.signal,
        );
      }
      return call(
        "GET",
        "/v1/admin/feedback/summary",
        { days: args.days === undefined ? undefined : String(args.days) },
        undefined,
        extra.signal,
      );
    },
  );
}
