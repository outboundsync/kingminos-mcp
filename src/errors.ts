import { TENANT_BEARER_ENV } from "./config.js";

export type ErrorCode =
  | "auth_required"
  | "unauthorized"
  | "forbidden"
  | "bad_request"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "upstream_error";

export interface RemediationContext {
  retried?: boolean;
  detail?: string;
  /** Envelope `error` code from the API body (e.g. webhooks_not_enabled). */
  apiError?: string;
}

/** Remediation keyed by the API envelope error code; wins over the status-based text. */
const API_ERROR_REMEDIATION: Record<string, string> = {
  webhooks_not_enabled:
    "Webhooks are not enabled for this workspace; ask KingMinos support to enable them.",
  webhook_owner_required:
    "Webhook changes need the workspace owner (session or owner key).",
  webhook_endpoint_inactive:
    "The endpoint is paused; re-enable it with patch_webhook is_active=true first.",
};

export interface ToolErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    status?: number;
    retryAfterSeconds?: number;
    remediation?: string;
    request_id?: string | null;
    detail?: string;
    retryable: boolean;
  };
}

export class KingMinosApiError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly remediation?: string;
  readonly requestId?: string | null;
  readonly detail?: string;
  readonly retryable: boolean;

  constructor(args: {
    code: ErrorCode;
    message: string;
    status?: number;
    retryAfterSeconds?: number;
    remediation?: string;
    requestId?: string | null;
    detail?: string;
    retryable?: boolean;
  }) {
    super(args.message);
    this.name = "KingMinosApiError";
    this.code = args.code;
    this.status = args.status;
    this.retryAfterSeconds = args.retryAfterSeconds;
    this.remediation = args.remediation;
    this.requestId = args.requestId;
    this.detail = args.detail;
    this.retryable = args.retryable ?? false;
  }

  withRemediation(remediation: string): KingMinosApiError {
    return new KingMinosApiError({
      code: this.code,
      message: this.message,
      status: this.status,
      retryAfterSeconds: this.retryAfterSeconds,
      remediation,
      requestId: this.requestId,
      detail: this.detail,
      retryable: this.retryable,
    });
  }
}

export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 400:
    case 422:
      return "bad_request";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return "upstream_error";
  }
}

export function remediationFor(
  code: ErrorCode,
  status?: number,
  extra: RemediationContext = {},
): string | undefined {
  const retried = extra.retried === true;
  const byApiError =
    extra.apiError !== undefined &&
    Object.hasOwn(API_ERROR_REMEDIATION, extra.apiError)
      ? API_ERROR_REMEDIATION[extra.apiError]
      : undefined;
  if (byApiError !== undefined) {
    return byApiError;
  }
  switch (code) {
    case "auth_required":
      return `Add Authorization: Bearer <token> or set ${TENANT_BEARER_ENV}.`;
    case "unauthorized":
      return extra.detail === "mismatch"
        ? "The tenant Bearer did not match (detail: mismatch). Verify or rotate it."
        : "Verify or rotate the KingMinos tenant Bearer. 401 detail may be missing, malformed, or mismatch.";
    case "forbidden":
      return "The key is valid but lacks this scope (write tools need a capable key; delete_subject needs erase).";
    case "bad_request":
      return "Fix the named arguments. Retrying unchanged fails the same way.";
    case "not_found":
      return "Confirm the id exists for this tenant. Do not retry a missing route.";
    case "rate_limited":
      return retried
        ? "Already retried once after Retry-After. Wait retryAfterSeconds, then retry the same Idempotency-Key."
        : "Wait retryAfterSeconds, then retry the same Idempotency-Key.";
    case "timeout":
      return retried
        ? "Already retried once. Treat as unknown, not empty. Retry once more only if the call is a read or has an Idempotency-Key."
        : "Treat as unknown, not empty. Retry once or narrow the request.";
    case "upstream_error":
      if (status === 504) {
        return retried
          ? "Already retried once. The API already spent its query budget — do not blindly retry the same call."
          : "The API already spent its query budget — do not blindly retry the same call.";
      }
      return retried
        ? "Already retried once. Relay the API message. Retry only a 5xx that is not 504, and only for reads or idempotent writes."
        : "Relay the API message. Retry only a 5xx that is not 504, and only for reads or idempotent writes.";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export function toToolErrorBody(error: KingMinosApiError): ToolErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      ...(error.remediation !== undefined
        ? { remediation: error.remediation }
        : {}),
      ...(error.requestId !== undefined ? { request_id: error.requestId } : {}),
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
      retryable: error.retryable,
    },
  };
}

export function toolErrorResult(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  const mapped =
    error instanceof KingMinosApiError
      ? error
      : new KingMinosApiError({
          code: "upstream_error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(toToolErrorBody(mapped)),
      },
    ],
  };
}
