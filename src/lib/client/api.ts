import { z } from "zod";

export interface ApiErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: {
      readonly status: number;
      readonly code: string;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly requestId?: string | null;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? {};
    this.requestId = options.requestId ?? null;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (
    init.body !== undefined &&
    init.body !== null &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      headers,
    });
  } catch (cause) {
    throw new ApiClientError("Unable to reach OpenMarket. Check your connection and try again.", {
      status: 0,
      code: "NETWORK_ERROR",
      cause,
    });
  }

  const requestId = response.headers.get("X-Request-ID");
  const contentType = response.headers.get("Content-Type") ?? "";
  let payload: unknown;

  if (contentType.toLowerCase().includes("application/json")) {
    try {
      payload = await response.json();
    } catch (cause) {
      throw new ApiClientError("OpenMarket returned an unreadable response.", {
        status: response.status,
        code: "INVALID_RESPONSE",
        requestId,
        cause,
      });
    }
  }

  if (!response.ok) {
    const parsedError = z
      .object({
        error: z.object({
          code: z.string(),
          message: z.string(),
          details: z.record(z.string(), z.unknown()).default({}),
        }),
      })
      .safeParse(payload);
    const apiError = parsedError.success ? parsedError.data.error : null;
    throw new ApiClientError(
      apiError?.message ?? `Request failed with status ${response.status}.`,
      {
        status: response.status,
        code: apiError?.code ?? "REQUEST_FAILED",
        ...(apiError === null ? {} : { details: apiError.details }),
        requestId,
      },
    );
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiClientError("OpenMarket returned a non-JSON response.", {
      status: response.status,
      code: "INVALID_RESPONSE",
      requestId,
    });
  }

  return payload as T;
}
