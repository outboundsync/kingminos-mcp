import {
  apiBaseUrl,
  RETRY_DELAY_MS,
  TENANT_BEARER_ENV,
  UPSTREAM_TIMEOUT_MS,
} from "./config.js";
import {
  errorCodeForStatus,
  KingMinosApiError,
  remediationFor,
} from "./errors.js";

export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiRequestOptions {
  method: ApiMethod;
  path: string;
  bearer: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  baseUrl?: string;
}

interface ErrorEnvelope {
  ok?: boolean;
  error?: string;
  detail?: string;
  hint?: string;
  request_id?: string | null;
  retryable?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseErrorEnvelope(value: unknown): ErrorEnvelope | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ok: typeof value.ok === "boolean" ? value.ok : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
    detail: typeof value.detail === "string" ? value.detail : undefined,
    hint: typeof value.hint === "string" ? value.hint : undefined,
    request_id:
      typeof value.request_id === "string" || value.request_id === null
        ? value.request_id
        : undefined,
    retryable: typeof value.retryable === "boolean" ? value.retryable : undefined,
  };
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  if (/^\d+$/.test(header)) {
    return Number(header);
  }
  const when = Date.parse(header);
  if (Number.isNaN(when)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

function joinUrl(
  path: string,
  query?: Record<string, string | undefined>,
  baseUrl?: string,
): string {
  const url = new URL(path, `${baseUrl ?? apiBaseUrl()}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

function shouldRetryRead(method: ApiMethod, status: number): boolean {
  if (method !== "GET") {
    return false;
  }
  if (status === 504) {
    return false;
  }
  return status >= 500 && status <= 599;
}

export function requireBearer(bearer: string | undefined): string {
  const trimmed = bearer?.trim();
  if (!trimmed) {
    throw new KingMinosApiError({
      code: "auth_required",
      message: `No tenant Bearer. Pass Authorization: Bearer <token> or set ${TENANT_BEARER_ENV}.`,
      remediation: remediationFor("auth_required"),
    });
  }
  return trimmed;
}

async function once(options: ApiRequestOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${options.bearer}`);
  headers.set("Accept", "application/json");
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (value !== undefined && value.length > 0) {
        headers.set(key, value);
      }
    }
  }

  try {
    const response = await fetch(joinUrl(options.path, options.query, options.baseUrl), {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = text;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    } else {
      parsed = null;
    }

    if (!response.ok) {
      const envelope = parseErrorEnvelope(parsed);
      const code = errorCodeForStatus(response.status);
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
      const message =
        envelope?.error ??
        envelope?.hint ??
        (typeof parsed === "string" && parsed.length > 0
          ? parsed
          : `KingMinos API ${response.status}`);
      throw new KingMinosApiError({
        code,
        message,
        status: response.status,
        retryAfterSeconds,
        remediation: remediationFor(code, response.status),
        requestId: envelope?.request_id,
        detail: envelope?.detail,
        retryable:
          envelope?.retryable ??
          (response.status === 429 ||
            (response.status >= 500 && response.status !== 504)),
      });
    }

    return parsed;
  } catch (error) {
    if (error instanceof KingMinosApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new KingMinosApiError({
        code: "timeout",
        message: `KingMinos API did not answer within ${UPSTREAM_TIMEOUT_MS / 1000}s.`,
        remediation: remediationFor("timeout"),
        retryable: true,
      });
    }
    throw new KingMinosApiError({
      code: "upstream_error",
      message: error instanceof Error ? error.message : "KingMinos API request failed",
      remediation: remediationFor("upstream_error"),
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function apiRequest(options: ApiRequestOptions): Promise<unknown> {
  try {
    return await once(options);
  } catch (error) {
    if (!(error instanceof KingMinosApiError)) {
      throw error;
    }
    if (error.code === "rate_limited") {
      const waitSeconds = error.retryAfterSeconds ?? 1;
      if (waitSeconds * 1000 <= UPSTREAM_TIMEOUT_MS) {
        await sleep(waitSeconds * 1000);
        return await once(options);
      }
      throw error;
    }
    if (
      error.status !== undefined &&
      shouldRetryRead(options.method, error.status)
    ) {
      await sleep(RETRY_DELAY_MS);
      return await once(options);
    }
    throw error;
  }
}

export function okText(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
