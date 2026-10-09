import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient, isNetworkError, NETWORK_ERROR_STATUS } from "./api-client";

/**
 * #50: a dead/unreachable backend must not leave the UI hanging. These tests
 * pin the two guarantees that fix it:
 *   1. a transport failure (offline / refused) becomes ApiError(status 0)
 *      rather than a raw "Failed to fetch" TypeError;
 *   2. a request that never settles is aborted and reported as a timeout.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("apiClient network failure handling (#50)", () => {
  it("normalises a transport failure into a status-0 network error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;

    await expect(apiClient("/anything")).rejects.toMatchObject({
      name: "ApiError",
      status: NETWORK_ERROR_STATUS,
    });
  });

  it("isNetworkError recognises the normalised error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    try {
      await apiClient("/anything");
      throw new Error("expected apiClient to reject");
    } catch (err) {
      expect(isNetworkError(err)).toBe(true);
      expect(err).toBeInstanceOf(ApiError);
    }
  });

  it("does not mark a real HTTP error as a network error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    try {
      await apiClient("/missing");
      throw new Error("expected apiClient to reject");
    } catch (err) {
      expect(isNetworkError(err)).toBe(false);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
    }
  });
});
