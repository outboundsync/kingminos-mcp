export type ErrorCode =
  | "auth_required"
  | "unauthorized"
  | "forbidden"
  | "bad_request"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "upstream_error";

export interface ToolErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    status?: number;
    retryAfterSeconds?: number;
    remediation?: string;
    request_id?: string | null;
    detail?: string;
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

export function remediationFor(code: ErrorCode, status?: number): string | undefined {
  switch (code) {
    case "auth_required":
      return `Add Authorization: Bearer <token> or set ${"KINGMINOS_API_KEY"}.`;
    case "unauthorized":
      return "Verify or rotate the KingMinos tenant Bearer.";
    case "forbidden":
      return "The key is valid but lacks this scope (write tools need a capable key; delete_subject needs erase).";
    case "bad_request":
      return "Fix the named arguments. Retrying unchanged fails the same way.";
    case "not_found":
      return "Confirm the id exists for this tenant. Do not retry a missing route.";
    case "rate_limited":
      return "Wait retryAfterSeconds, then retry the same Idempotency-Key.";
    case "timeout":
      return "Treat as unknown, not empty. Retry once or narrow the request.";
    case "upstream_error":
      return status === 504
        ? "The API already spent its query budget — do not blindly retry the same call."
        : "Relay the API message. Retry only a 5xx that is not 504, and only for reads.";
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
      ...(error.remediation !== undefined ? { remediation: error.remediation } : {}),
      ...(error.requestId !== undefined ? { request_id: error.requestId } : {}),
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
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
        text: JSON.stringify(toToolErrorBody(mapped), null, 2),
      },
    ],
  };
}
