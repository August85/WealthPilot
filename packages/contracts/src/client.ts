/**
 * Thin typed fetch client for the WealthPilot v1 API (docs/api-contract.md).
 *
 * Deliberately small and isolated: it maps endpoints to typed functions and nothing more, so it can be
 * replaced by a client generated from `/v1/openapi.json` without touching app code that depends on
 * the `ApiClient` shape.
 *
 * - Sends `Authorization: Bearer <token>` from `getToken()`.
 * - Adds an `Idempotency-Key` header to every POST (override per call to make retries safe).
 * - Decimal strings are passed through untouched (no JSON number coercion).
 * - Non-2xx responses throw `ApiError` (RFC 7807, with `code`); transport failures throw `NetworkError`.
 */
import { ApiError, NetworkError, toProblem } from './errors';
import type {
  Account,
  AccountCreate,
  AccountListParams,
  AccountUpdate,
  AuditEvent,
  Comparison,
  ComparisonRequest,
  DeleteRequest,
  DeleteRequestResponse,
  DeviceRegistration,
  ExportCreate,
  ExportJob,
  FxPairParams,
  FxRate,
  FxRateCreate,
  Goal,
  GoalCreate,
  GoalUpdate,
  HealthStatus,
  Household,
  HouseholdUpdate,
  InboxNotification,
  Insight,
  ListResponse,
  Me,
  MeUpdate,
  NetWorth,
  NetWorthHistoryParams,
  NetWorthHistoryPoint,
  NetWorthParams,
  NotificationPreference,
  NotificationPreferencesUpdate,
  OnboardingRequest,
  PageParams,
  PriceCreate,
  PriceQuote,
  RsuDisposition,
  RsuDispositionCreate,
  RsuGrant,
  RsuGrantCreate,
  RsuGrantUpdate,
  RsuVest,
  RsuVestCreate,
  RsuVestUpdate,
  RunCreate,
  RunResult,
  Scenario,
  ScenarioAssumptions,
  ScenarioCloneRequest,
  ScenarioCreate,
  ScenarioDefaultsParams,
  ScenarioUpdate,
  ScenarioVersion,
  ScenarioVersionCreate,
  SimulationRun,
  TaxResidencyPeriod,
  TaxResidencyPeriodInput,
  Valuation,
  ValuationCreate,
  VestCalendarParams,
  VestCalendarResponse,
} from './types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  signal?: AbortSignal;
  /** Override the generated Idempotency-Key (POST only). Reuse the same key when retrying a request. */
  idempotencyKey?: string;
}

export interface ApiClientOptions {
  /** Base URL including the version prefix, e.g. `https://api.example.com/v1`. A missing `/v1` is appended. */
  baseUrl: string;
  /** Returns the bearer token (Clerk session JWT, or `dev:<sub>:<email>` in dev mode). */
  getToken: () => Promise<string | null | undefined> | string | null | undefined;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Generates Idempotency-Key values for POSTs. Defaults to a random UUID v4. */
  generateIdempotencyKey?: () => string;
  /** Called after every response (for request-id logging without bodies). */
  onResponse?: (info: { method: HttpMethod; path: string; status: number; requestId: string | null }) => void;
}

export interface RawRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Skip the Authorization header (e.g. /healthz). */
  anonymous?: boolean;
  options?: RequestOptions;
}

/** RFC 4122 v4 UUID using crypto.randomUUID / getRandomValues when available. */
export function generateUuidV4(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (!/\/v1$/.test(url)) url = `${url}/v1`;
  return url;
}

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const enc = encodeURIComponent;

export function createApiClient(opts: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const newKey = opts.generateIdempotencyKey ?? generateUuidV4;

  async function request<T>(req: RawRequest): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (!req.anonymous) {
      const token = await opts.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    if (req.method === 'POST') headers['Idempotency-Key'] = req.options?.idempotencyKey ?? newKey();

    const url = `${baseUrl}${req.path}${buildQuery(req.query)}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: req.options?.signal,
      });
    } catch (e) {
      throw new NetworkError('Could not reach WealthPilot. Check your connection.', e);
    }

    const requestId = res.headers.get('X-Request-ID');
    opts.onResponse?.({ method: req.method, path: req.path, status: res.status, requestId });

    const text = res.status === 204 ? '' : await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
    }
    if (!res.ok) {
      throw new ApiError(toProblem(res.status, res.statusText, data), requestId);
    }
    return data as T;
  }

  const get = <T>(path: string, query?: Record<string, QueryValue>, options?: RequestOptions) =>
    request<T>({ method: 'GET', path, query, options });
  const post = <T>(path: string, body?: unknown, options?: RequestOptions, query?: Record<string, QueryValue>) =>
    request<T>({ method: 'POST', path, body: body ?? {}, options, query });
  const put = <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>({ method: 'PUT', path, body, options });
  const patch = <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>({ method: 'PATCH', path, body, options });
  const del = <T = void>(path: string, options?: RequestOptions) =>
    request<T>({ method: 'DELETE', path, options });

  const pageQuery = (p?: PageParams) => ({ limit: p?.limit, cursor: p?.cursor });

  return {
    /** Escape hatch for endpoints not yet modeled. */
    request,
    baseUrl,

    health: {
      healthz: (o?: RequestOptions) => request<HealthStatus>({ method: 'GET', path: '/healthz', anonymous: true, options: o }),
      readyz: (o?: RequestOptions) => request<HealthStatus>({ method: 'GET', path: '/readyz', anonymous: true, options: o }),
    },

    me: {
      get: (o?: RequestOptions) => get<Me>('/me', undefined, o),
      update: (body: MeUpdate, o?: RequestOptions) => patch<Me>('/me', body, o),
      onboard: (body: OnboardingRequest, o?: RequestOptions) => post<Me>('/me/onboarding', body, o),
      getTaxResidency: (o?: RequestOptions) => get<ListResponse<TaxResidencyPeriod>>('/me/tax-residency', undefined, o),
      replaceTaxResidency: (items: TaxResidencyPeriodInput[], o?: RequestOptions) =>
        put<ListResponse<TaxResidencyPeriod>>('/me/tax-residency', { items }, o),
      securityEvents: (p?: PageParams, o?: RequestOptions) =>
        get<ListResponse<AuditEvent>>('/me/security-events', pageQuery(p), o),
    },

    privacy: {
      requestDeletion: (body: DeleteRequest, o?: RequestOptions) =>
        post<DeleteRequestResponse>('/privacy/delete-request', body, o),
    },

    households: {
      get: (id: string, o?: RequestOptions) => get<Household>(`/households/${enc(id)}`, undefined, o),
      update: (id: string, body: HouseholdUpdate, o?: RequestOptions) =>
        patch<Household>(`/households/${enc(id)}`, body, o),
      /** Post-MVP: the API returns 501. */
      invite: (id: string, body: { email: string; role: string }, o?: RequestOptions) =>
        post<unknown>(`/households/${enc(id)}/invites`, body, o),
    },

    accounts: {
      list: (params?: AccountListParams, o?: RequestOptions) =>
        get<ListResponse<Account>>('/accounts', { ...params }, o),
      create: (body: AccountCreate, o?: RequestOptions) => post<Account>('/accounts', body, o),
      get: (id: string, o?: RequestOptions) => get<Account>(`/accounts/${enc(id)}`, undefined, o),
      update: (id: string, body: AccountUpdate, o?: RequestOptions) => patch<Account>(`/accounts/${enc(id)}`, body, o),
      remove: (id: string, o?: RequestOptions) => del(`/accounts/${enc(id)}`, o),
      listValuations: (id: string, o?: RequestOptions) =>
        get<ListResponse<Valuation>>(`/accounts/${enc(id)}/valuations`, undefined, o),
      addValuation: (id: string, body: ValuationCreate, o?: RequestOptions) =>
        post<Valuation>(`/accounts/${enc(id)}/valuations`, body, o),
    },

    fx: {
      getRate: (p: FxPairParams, o?: RequestOptions) => get<FxRate>('/fx/rates', { ...p }, o),
      saveRate: (body: FxRateCreate, o?: RequestOptions) => post<FxRate>('/fx/rates', body, o),
      getReference: (p: FxPairParams, o?: RequestOptions) => get<FxRate>('/fx/reference', { ...p }, o),
    },

    prices: {
      get: (symbol: string, o?: RequestOptions) => get<PriceQuote>('/prices', { symbol }, o),
      save: (body: PriceCreate, o?: RequestOptions) => post<PriceQuote>('/prices', body, o),
    },

    rsu: {
      listGrants: (o?: RequestOptions) => get<ListResponse<RsuGrant>>('/rsu/grants', undefined, o),
      getGrant: (id: string, o?: RequestOptions) => get<RsuGrant>(`/rsu/grants/${enc(id)}`, undefined, o),
      createGrant: (body: RsuGrantCreate, o?: RequestOptions) => post<RsuGrant>('/rsu/grants', body, o),
      updateGrant: (id: string, body: RsuGrantUpdate, o?: RequestOptions) =>
        patch<RsuGrant>(`/rsu/grants/${enc(id)}`, body, o),
      deleteGrant: (id: string, o?: RequestOptions) => del(`/rsu/grants/${enc(id)}`, o),
      addVest: (grantId: string, body: RsuVestCreate, o?: RequestOptions) =>
        post<RsuVest>(`/rsu/grants/${enc(grantId)}/vests`, body, o),
      updateVest: (vestId: string, body: RsuVestUpdate, o?: RequestOptions) =>
        patch<RsuVest>(`/rsu/vests/${enc(vestId)}`, body, o),
      deleteVest: (vestId: string, o?: RequestOptions) => del(`/rsu/vests/${enc(vestId)}`, o),
      addDisposition: (vestId: string, body: RsuDispositionCreate, o?: RequestOptions) =>
        post<RsuDisposition>(`/rsu/vests/${enc(vestId)}/dispositions`, body, o),
      calendar: (p?: VestCalendarParams, o?: RequestOptions) =>
        get<VestCalendarResponse>('/rsu/calendar', { ...p }, o),
    },

    netWorth: {
      get: (p: NetWorthParams, o?: RequestOptions) => get<NetWorth>('/net-worth', { ...p }, o),
      history: (p: NetWorthHistoryParams, o?: RequestOptions) =>
        get<ListResponse<NetWorthHistoryPoint>>('/net-worth/history', { ...p }, o),
    },

    insights: {
      list: (p: { currency: string }, o?: RequestOptions) => get<ListResponse<Insight>>('/insights', { ...p }, o),
    },

    goals: {
      list: (o?: RequestOptions) => get<ListResponse<Goal>>('/goals', undefined, o),
      create: (body: GoalCreate, o?: RequestOptions) => post<Goal>('/goals', body, o),
      get: (id: string, o?: RequestOptions) => get<Goal>(`/goals/${enc(id)}`, undefined, o),
      update: (id: string, body: GoalUpdate, o?: RequestOptions) => patch<Goal>(`/goals/${enc(id)}`, body, o),
      remove: (id: string, o?: RequestOptions) => del(`/goals/${enc(id)}`, o),
    },

    scenarios: {
      list: (p?: { include_archived?: boolean }, o?: RequestOptions) =>
        get<ListResponse<Scenario>>('/scenarios', { ...p }, o),
      create: (body: ScenarioCreate, o?: RequestOptions) => post<Scenario>('/scenarios', body, o),
      get: (id: string, o?: RequestOptions) => get<Scenario>(`/scenarios/${enc(id)}`, undefined, o),
      update: (id: string, body: ScenarioUpdate, o?: RequestOptions) =>
        patch<Scenario>(`/scenarios/${enc(id)}`, body, o),
      clone: (id: string, body: ScenarioCloneRequest, o?: RequestOptions) =>
        post<Scenario>(`/scenarios/${enc(id)}/clone`, body, o),
      defaults: (p: ScenarioDefaultsParams, o?: RequestOptions) =>
        get<ScenarioAssumptions>('/scenarios/defaults', { ...p }, o),
      listVersions: (id: string, o?: RequestOptions) =>
        get<ListResponse<ScenarioVersion>>(`/scenarios/${enc(id)}/versions`, undefined, o),
      createVersion: (id: string, body: ScenarioVersionCreate, o?: RequestOptions) =>
        post<ScenarioVersion>(`/scenarios/${enc(id)}/versions`, body, o),
    },

    runs: {
      create: (versionId: string, body: RunCreate = { seed: null }, o?: RequestOptions) =>
        post<SimulationRun>(`/scenario-versions/${enc(versionId)}/runs`, body, o),
      get: (id: string, o?: RequestOptions) => get<SimulationRun>(`/runs/${enc(id)}`, undefined, o),
      results: (id: string, o?: RequestOptions) => get<RunResult>(`/runs/${enc(id)}/results`, undefined, o),
    },

    comparisons: {
      create: (body: ComparisonRequest, o?: RequestOptions) => post<Comparison>('/comparisons', body, o),
    },

    exports: {
      create: (body: ExportCreate, o?: RequestOptions) => post<ExportJob>('/exports', body, o),
      get: (id: string, o?: RequestOptions) => get<ExportJob>(`/exports/${enc(id)}`, undefined, o),
      /** Resolve a (possibly relative) signed `download_url` to an absolute URL. No bearer needed to fetch it. */
      resolveDownloadUrl: (job: Pick<ExportJob, 'download_url'>): string | null => {
        if (!job.download_url) return null;
        if (/^https?:\/\//i.test(job.download_url)) return job.download_url;
        const origin = baseUrl.replace(/\/v1$/, '');
        if (job.download_url.startsWith('/v1/')) return `${origin}${job.download_url}`;
        if (job.download_url.startsWith('/')) return `${baseUrl}${job.download_url}`;
        return `${baseUrl}/${job.download_url}`;
      },
    },

    notifications: {
      getPreferences: (o?: RequestOptions) =>
        get<ListResponse<NotificationPreference>>('/notification-preferences', undefined, o),
      updatePreferences: (body: NotificationPreferencesUpdate, o?: RequestOptions) =>
        patch<ListResponse<NotificationPreference>>('/notification-preferences', body, o),
      registerDevice: (body: DeviceRegistration, o?: RequestOptions) => post<unknown>('/devices', body, o),
      unregisterDevice: (token: string, o?: RequestOptions) => del(`/devices/${enc(token)}`, o),
      inbox: (p?: PageParams, o?: RequestOptions) =>
        get<ListResponse<InboxNotification>>('/notifications', pageQuery(p), o),
      markRead: (id: string, o?: RequestOptions) => post<unknown>(`/notifications/${enc(id)}/read`, undefined, o),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
