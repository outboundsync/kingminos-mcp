// Sentry error reporting (README: Sentry). DSN is the SENTRY_DSN secret;
// without it the SDK is never initialised.
// Privacy: no PII, no request bodies, no MCP tool arguments. Only uncaught
// Worker exceptions are sent (the MCP SDK turns tool errors into responses).
import type {
  CloudflareOptions,
  ErrorEvent,
  EventHint,
} from "@sentry/cloudflare";
import * as Sentry from "@sentry/cloudflare";

type SentryEnv = {
  SENTRY_DSN?: string;
  SENTRY_RELEASE?: string;
  ENVIRONMENT?: string;
};

const REDACTED = "[redacted]";
const SENSITIVE_HEADER =
  /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization|cf-access-.*|x-kingminos-.*)$/i;
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(?:km|kmwhsec|osr)_[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s"'<>]*/gi,
];

export function scrubString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return scrubString(value);
  }
  if (depth > 6 || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      /secret|password|token|authorization|cookie|api[_-]?key|email|body|payload|input/i.test(
        key,
      )
        ? REDACTED
        : scrubDeep(item, depth + 1);
  }
  return out;
}

function stripQuery(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }
  const at = url.indexOf("?");
  return scrubString(at === -1 ? url : url.slice(0, at));
}

export function scrubEvent(
  event: ErrorEvent,
  _hint?: EventHint,
): ErrorEvent | null {
  event.user = undefined;
  if (event.request) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.request.headers ?? {})) {
      headers[key] = SENSITIVE_HEADER.test(key)
        ? REDACTED
        : scrubString(String(value));
    }
    event.request = {
      method: event.request.method,
      url: stripQuery(event.request.url),
      headers,
    };
  }
  if (event.message) {
    event.message = scrubString(event.message);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = scrubString(exception.value);
    }
    for (const frame of exception.stacktrace?.frames ?? []) {
      frame.vars = undefined;
    }
  }
  if (event.extra) {
    event.extra = scrubDeep(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    event.contexts = scrubDeep(event.contexts) as typeof event.contexts;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? scrubString(crumb.message) : crumb.message,
      data: crumb.data
        ? (scrubDeep({
            ...crumb.data,
            url: stripQuery(crumb.data.url as string | undefined),
          }) as Record<string, unknown>)
        : crumb.data,
    }));
  }
  return event;
}

export function sentryOptions(env: SentryEnv): CloudflareOptions | undefined {
  if (!env.SENTRY_DSN) {
    return undefined;
  }
  return {
    dsn: env.SENTRY_DSN,
    environment: env.ENVIRONMENT || "production",
    release: env.SENTRY_RELEASE,
    // SDK v11 replaces sendDefaultPii with dataCollection; this is stricter
    // than sendDefaultPii: false (no user info, cookies, bodies or queries).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { allow: ["user-agent", "content-type"] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
    },
    tracesSampleRate: 0,
    maxBreadcrumbs: 20,
    beforeSend: scrubEvent,
    beforeSendTransaction: () => null,
    // console.* lines can carry customer fields; fetch crumbs keep host/path only.
    beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
  };
}

/** Report an unexpected platform error. Never throws; no-op without a DSN client. */
export function reportError(
  error: unknown,
  tags?: Record<string, string>,
): void {
  try {
    Sentry.captureException(error, tags ? { tags } : undefined);
  } catch {
    // never let telemetry break the request path
  }
}

/** Report a platform message (e.g. run.failed). Never throws. */
export function reportMessage(
  message: string,
  tags: Record<string, string>,
): void {
  try {
    Sentry.captureMessage(message, { level: "error", tags });
  } catch {
    // never let telemetry break the request path
  }
}
