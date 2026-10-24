import { z } from "zod";

import { env } from "./env";

const ABSOLUTE_URL = /^[a-zA-Z][a-zA-Z+\-.]*:/;

const problemSchema = z.object({
  code: z.string().optional(),
  detail: z.string().optional(),
  title: z.string().optional(),
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      cause?: unknown;
    },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ApiError";
    this.status = options?.status ?? 0;
    this.code = options?.code ?? "api_error";
  }
}

type PreparedRequest = {
  url: string;
  init: RequestInit;
};

/**
 * Resolve a path against the API origin.
 * Userinfo and any other origin are refused before a request exists,
 * so credentials and Authorization cannot be sent there.
 * `redirect: "error"` stops a redirect from carrying them onward.
 */
function prepareRequest(
  path: string,
  init: RequestInit | undefined,
): PreparedRequest {
  const url = resolveApiUrl(path, env.NEXT_PUBLIC_API_BASE_URL);
  const requested = init?.credentials;
  const credentials: RequestCredentials =
    requested === "include" || requested === "same-origin" ? requested : "omit";

  return {
    url: url.href,
    init: {
      ...init,
      credentials,
      redirect: "error",
    },
  };
}

function resolveApiUrl(path: string, base: string): URL {
  if (path.startsWith("//")) {
    throw new ApiError("Refusing to contact an origin other than the API", {
      code: "forbidden_origin",
    });
  }

  const api = new URL(base);
  let url: URL;
  try {
    if (ABSOLUTE_URL.test(path)) {
      url = new URL(path);
    } else if (path.startsWith("/")) {
      url = new URL(path, api.origin);
    } else {
      const prefix = base.endsWith("/") ? base : `${base}/`;
      url = new URL(path, prefix);
    }
  } catch (error) {
    throw new ApiError("API path is not a valid URL", {
      code: "invalid_path",
      cause: error,
    });
  }

  if (url.username !== "" || url.password !== "") {
    throw new ApiError("Refusing to send credentials embedded in a URL", {
      code: "embedded_credentials",
    });
  }
  if (url.origin !== api.origin) {
    throw new ApiError("Refusing to contact an origin other than the API", {
      code: "forbidden_origin",
    });
  }
  return url;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }
  try {
    return parseJson(text);
  } catch (error) {
    if (!response.ok) {
      return undefined;
    }
    throw new ApiError("API response was not valid JSON", {
      status: response.status,
      code: "invalid_json",
      cause: error,
    });
  }
}

function problemError(response: Response, body: unknown): ApiError {
  const parsed = problemSchema.safeParse(body);
  const problem = parsed.success ? parsed.data : undefined;
  const detail = problem?.detail ?? problem?.title;
  return new ApiError(
    detail ?? `API request failed with status ${response.status}`,
    {
      status: response.status,
      code: problem?.code ?? "http_error",
    },
  );
}

export async function apiFetch<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  init?: RequestInit,
): Promise<z.output<TSchema>> {
  const request = prepareRequest(path, init);
  let response: Response;
  try {
    response = await fetch(request.url, request.init);
  } catch (error) {
    throw new ApiError("API request failed", { code: "network", cause: error });
  }

  const body = await readBody(response);
  if (!response.ok) {
    throw problemError(response, body);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError("API response did not match the expected schema", {
      status: response.status,
      code: "invalid_response",
      cause: parsed.error,
    });
  }
  return parsed.data;
}
