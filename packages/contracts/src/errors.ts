import type { ProblemDocument, ProblemFieldError } from './types';

/**
 * An RFC 7807 problem returned by the API (any non-2xx response).
 * `code` is the machine-readable problem code (e.g. `VERSION_CONFLICT`, `PLAN_LIMIT`).
 */
export class ApiError extends Error {
  readonly name = 'ApiError';
  readonly status: number;
  readonly code: string | null;
  readonly title: string;
  readonly detail: string | null;
  readonly type: string;
  readonly requestId: string | null;
  readonly fieldErrors: ProblemFieldError[];
  readonly problem: ProblemDocument;

  constructor(problem: ProblemDocument, requestId?: string | null) {
    super(problem.detail || problem.title || `HTTP ${problem.status}`);
    this.problem = problem;
    this.status = problem.status;
    this.code = problem.code ?? null;
    this.title = problem.title;
    this.detail = problem.detail ?? null;
    this.type = problem.type;
    this.requestId = problem.request_id ?? requestId ?? null;
    this.fieldErrors = problem.errors ?? [];
  }

  get isVersionConflict(): boolean {
    return this.status === 409 && this.code === 'VERSION_CONFLICT';
  }

  get isPlanLimit(): boolean {
    return this.status === 402 && this.code === 'PLAN_LIMIT';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }
}

/** The request never produced an HTTP response (offline, DNS, TLS, aborted). */
export class NetworkError extends Error {
  readonly name = 'NetworkError';
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}

export function isApiErrorCode(e: unknown, code: string): e is ApiError {
  return e instanceof ApiError && e.code === code;
}

/** Build a ProblemDocument from an arbitrary error body (falls back to a generic one). */
export function toProblem(status: number, statusText: string, body: unknown): ProblemDocument {
  if (body && typeof body === 'object' && 'status' in body && 'title' in body) {
    return body as ProblemDocument;
  }
  if (body && typeof body === 'object' && 'detail' in body) {
    // FastAPI default `{"detail": ...}` shape, normalized.
    const detail = (body as { detail: unknown }).detail;
    return {
      type: 'about:blank',
      title: statusText || `HTTP ${status}`,
      status,
      detail: typeof detail === 'string' ? detail : undefined,
      errors: Array.isArray(detail)
        ? (detail as { loc?: (string | number)[]; msg?: string }[]).map((d) => ({
            loc: d.loc ?? [],
            msg: d.msg ?? '',
          }))
        : undefined,
    };
  }
  return { type: 'about:blank', title: statusText || `HTTP ${status}`, status };
}
