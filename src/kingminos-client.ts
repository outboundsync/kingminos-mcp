import {
  apiBaseUrl,
  MAX_RATE_LIMIT_WAIT_MS,
  RETRY_DELAY_MS,
  TENANT_BEARER_ENV,
  UPSTREAM_TIMEOUT_MS,
} from "./config.js";
import {
  errorCodeForStatus,
  KingMinosApiError,
  remediationFor,
} from "./errors.js";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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
    retryable:
      typeof value.retryable === "boolean" ? value.retryable : undefined,
  };
}

export function parseRetryAfter(header: string | null): number | undefined {
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

export function joinUrl(
  path: string,
  query?: Record<string, string | undefined>,
  baseUrl?: string,
): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    throw new KingMinosApiError({
      code: "bad_request",
      message: "Absolute upstream paths are not allowed.",
      remediation: remediationFor("bad_request"),
      retryable: false,
    });
  }
  const base = `${(baseUrl ?? apiBaseUrl()).replace(/\/$/, "")}/`;
  const relative = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(relative, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

export function requestHasIdempotencyKey(options: ApiRequestOptions): boolean {
  const value =
    options.headers?.["Idempotency-Key"] ??
    options.headers?.["idempotency-key"];
  return typeof value === "string" && value.trim().length > 0;
}

export function methodAwareRetryable(args: {
  method: ApiMethod;
  status?: number;
  code?: string;
  hasIdempotencyKey: boolean;
  cancelled?: boolean;
}): boolean {
  if (args.cancelled) {
    return false;
  }
  if (args.status === 504) {
    return false;
  }
  const writesAllowed = args.method === "GET" || args.hasIdempotencyKey;
  if (args.status === 429) {
    return writesAllowed;
  }
  if (args.status !== undefined && args.status >= 500) {
    return writesAllowed;
  }
  if (args.code === "timeout") {
    return writesAllowed;
  }
  if (args.code === "upstream_error" && args.status === undefined) {
    return writesAllowed;
  }
  return false;
}

function canRetryMethod(options: ApiRequestOptions): boolean {
  return options.method === "GET" || requestHasIdempotencyKey(options);
}

function cancelledError(): KingMinosApiError {
  return new KingMinosApiError({
    code: "upstream_error",
    message: "Request was cancelled.",
    remediation:
      "The caller aborted the request. Do not treat this as a timeout.",
    retryable: false,
  });
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
  if (options.signal?.aborted) {
    throw cancelledError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${options.bearer}`);
  headers.set("Accept", "application/json");
  // Lets the API attribute calls to MCP (first-MCP-call onboarding grant).
  headers.set("X-KingMinos-Client", "mcp");
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
    const response = await fetch(
      joinUrl(options.path, options.query, options.baseUrl),
      {
        method: options.method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      },
    );

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
      const retryAfterSeconds = parseRetryAfter(
        response.headers.get("retry-after"),
      );
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
        remediation: remediationFor(code, response.status, {
          detail: envelope?.detail,
        }),
        requestId: envelope?.request_id,
        detail: envelope?.detail,
        retryable: methodAwareRetryable({
          method: options.method,
          status: response.status,
          code,
          hasIdempotencyKey: requestHasIdempotencyKey(options),
        }),
      });
    }

    return parsed;
  } catch (error) {
    if (error instanceof KingMinosApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      if (options.signal?.aborted) {
        throw cancelledError();
      }
      throw new KingMinosApiError({
        code: "timeout",
        message: `KingMinos API did not answer within ${UPSTREAM_TIMEOUT_MS / 1000}s.`,
        remediation: remediationFor("timeout"),
        retryable: methodAwareRetryable({
          method: options.method,
          code: "timeout",
          hasIdempotencyKey: requestHasIdempotencyKey(options),
        }),
      });
    }
    throw new KingMinosApiError({
      code: "upstream_error",
      message:
        error instanceof Error ? error.message : "KingMinos API request failed",
      remediation: remediationFor("upstream_error"),
      retryable: methodAwareRetryable({
        method: options.method,
        code: "upstream_error",
        hasIdempotencyKey: requestHasIdempotencyKey(options),
      }),
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function markRetried(error: KingMinosApiError): KingMinosApiError {
  return error.withRemediation(
    remediationFor(error.code, error.status, {
      retried: true,
      detail: error.detail,
    }) ??
      error.remediation ??
      "",
  );
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
      if (
        waitSeconds * 1000 <= MAX_RATE_LIMIT_WAIT_MS &&
        canRetryMethod(options)
      ) {
        await sleep(waitSeconds * 1000);
        try {
          return await once(options);
        } catch (retryError) {
          if (retryError instanceof KingMinosApiError) {
            throw markRetried(retryError);
          }
          throw retryError;
        }
      }
      throw error;
    }
    if (
      error.status !== undefined &&
      error.status >= 500 &&
      error.status !== 504 &&
      canRetryMethod(options)
    ) {
      await sleep(RETRY_DELAY_MS);
      try {
        return await once(options);
      } catch (retryError) {
        if (retryError instanceof KingMinosApiError) {
          throw markRetried(retryError);
        }
        throw retryError;
      }
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
        text: JSON.stringify(payload),
      },
    ],
  };
}
