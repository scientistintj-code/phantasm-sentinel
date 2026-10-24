import {
  addTargetsRequestSchema,
  caseListSchema,
  caseSchema,
  createCaseRequestSchema,
  graphSchema,
  investigateRequestSchema,
  keyHealthListSchema,
  ledgerPageSchema,
  problemSchema,
  targetAdmissionListSchema,
  targetReportSchema,
  verifyResultSchema,
  type AddTargetsRequest,
  type CaseRecord,
  type CreateCaseRequest,
  type Graph,
  type InvestigateRequest,
  type KeyHealth,
  type LedgerPage,
  type Problem,
  type TargetAdmission,
  type TargetReport,
  type VerifyResult,
} from "./schemas";
import type { z } from "zod";

export class ApiError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string | undefined;
  readonly instance: string | undefined;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.type = problem.type;
    this.title = problem.title;
    this.status = problem.status;
    this.detail = problem.detail;
    this.instance = problem.instance;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

function joinUrl(baseUrl: string, path: string): string {
  const root = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

function requestHeaders(jsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (jsonBody) headers["content-type"] = "application/json";
  return headers;
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  if (text) {
    try {
      const parsed = problemSchema.safeParse(JSON.parse(text));
      if (parsed.success) return new ApiError(parsed.data);
    } catch {
      // body was not a problem document
    }
  }
  return new ApiError({
    type: "about:blank",
    title: response.statusText || "Request failed",
    status: response.status,
    detail: text || undefined,
  });
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "/api/sentinel";
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(path: string, schema: z.ZodType<T>, init?: { method?: string; body?: unknown }): Promise<T> {
    const method = init?.method ?? "GET";
    const hasBody = init?.body !== undefined;
    const response = await fetchImpl(joinUrl(baseUrl, path), {
      method,
      credentials: "omit",
      headers: requestHeaders(hasBody),
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw await toApiError(response);
    if (response.status === 202 || response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError({
        type: "about:blank",
        title: "Invalid response",
        status: response.status,
        detail: "Response body is not JSON",
      });
    }
    return schema.parse(json);
  }

  async function accepted(path: string, body?: unknown): Promise<void> {
    const response = await fetchImpl(joinUrl(baseUrl, path), {
      method: "POST",
      credentials: "omit",
      headers: requestHeaders(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw await toApiError(response);
    if (response.status !== 202 && response.status !== 204) {
      throw new ApiError({
        type: "about:blank",
        title: "Unexpected response",
        status: response.status,
        detail: "Expected 202 Accepted",
      });
    }
  }

  return {
    eventsUrl(caseId: string): string {
      return joinUrl(baseUrl, `/v1/cases/${encodeURIComponent(caseId)}/events`);
    },

    listCases(): Promise<CaseRecord[]> {
      return request("/v1/cases", caseListSchema);
    },

    createCase(body: CreateCaseRequest): Promise<CaseRecord> {
      return request("/v1/cases", caseSchema, {
        method: "POST",
        body: createCaseRequestSchema.parse(body),
      });
    },

    getCase(caseId: string): Promise<CaseRecord> {
      return request(`/v1/cases/${encodeURIComponent(caseId)}`, caseSchema);
    },

    addTargets(caseId: string, body: AddTargetsRequest): Promise<TargetAdmission[]> {
      return request(`/v1/cases/${encodeURIComponent(caseId)}/targets`, targetAdmissionListSchema, {
        method: "POST",
        body: addTargetsRequestSchema.parse(body),
      });
    },

    investigate(caseId: string, body: InvestigateRequest = {}): Promise<void> {
      return accepted(
        `/v1/cases/${encodeURIComponent(caseId)}/investigate`,
        investigateRequestSchema.parse(body),
      );
    },

    cancelCase(caseId: string): Promise<void> {
      return accepted(`/v1/cases/${encodeURIComponent(caseId)}/cancel`);
    },

    approvePivot(caseId: string, pivotId: string): Promise<void> {
      return accepted(
        `/v1/cases/${encodeURIComponent(caseId)}/pivots/${encodeURIComponent(pivotId)}/approve`,
      );
    },

    getReport(caseId: string, targetId: string): Promise<TargetReport> {
      return request(
        `/v1/cases/${encodeURIComponent(caseId)}/targets/${encodeURIComponent(targetId)}/report`,
        targetReportSchema,
      );
    },

    getGraph(caseId: string): Promise<Graph> {
      return request(`/v1/cases/${encodeURIComponent(caseId)}/graph`, graphSchema);
    },

    getLedger(caseId: string, cursor?: string): Promise<LedgerPage> {
      const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      return request(`/v1/cases/${encodeURIComponent(caseId)}/ledger${query}`, ledgerPageSchema);
    },

    verifyLedger(caseId: string): Promise<VerifyResult> {
      return request(`/v1/cases/${encodeURIComponent(caseId)}/ledger/verify`, verifyResultSchema, {
        method: "POST",
      });
    },

    getKeyHealth(): Promise<KeyHealth[]> {
      return request("/v1/health/keys", keyHealthListSchema);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
