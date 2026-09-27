/**
 * Next.js API client with credentials inclusion, deduplication, and unmasked error parsing.
 * Adheres to AGENTS.md §11 (Universal API Error Formatting & Unmasked Toasts).
 */

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const inFlightGetRequests = new Map<string, Promise<any>>();

export async function apiClient<T = any>(
  endpoint: string,
  options?: RequestInit & { params?: Record<string, string | number | boolean | undefined | null> }
): Promise<T> {
  const { params, ...customConfig } = options || {};
  let url = endpoint.startsWith("http") ? endpoint : `/api${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "") {
        searchParams.append(key, String(val));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
  }

  const isGet = !customConfig.method || customConfig.method.toUpperCase() === "GET";

  if (isGet) {
    const cachedKey = url;
    if (inFlightGetRequests.has(cachedKey)) {
      return inFlightGetRequests.get(cachedKey)!;
    }

    const promise = (async () => {
      try {
        const response = await fetch(url, {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...customConfig.headers,
          },
          ...customConfig,
        });

        if (!response.ok) {
          let errorMsg = `Request failed: ${response.statusText}`;
          let errorData = null;
          try {
            errorData = await response.json();
            if (errorData?.message) {
              errorMsg = errorData.message;
            } else if (errorData?.error) {
              errorMsg = typeof errorData.error === "string" ? errorData.error : JSON.stringify(errorData.error);
            }
          } catch {
            // non-json error
          }
          throw new ApiError(errorMsg, response.status, errorData);
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          return await response.json();
        }
        return (await response.text()) as unknown as T;
      } finally {
        inFlightGetRequests.delete(cachedKey);
      }
    })();

    inFlightGetRequests.set(cachedKey, promise);
    return promise;
  }

  // Non-GET requests (mutations)
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...customConfig.headers,
    },
    ...customConfig,
  });

  if (!response.ok) {
    let errorMsg = `Request failed: ${response.statusText}`;
    let errorData = null;
    try {
      errorData = await response.json();
      if (errorData?.message) {
        errorMsg = errorData.message;
      } else if (errorData?.error) {
        errorMsg = typeof errorData.error === "string" ? errorData.error : JSON.stringify(errorData.error);
      }
    } catch {
      // non-json error
    }
    throw new ApiError(errorMsg, response.status, errorData);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return await response.json();
  }
  return (await response.text()) as unknown as T;
}
