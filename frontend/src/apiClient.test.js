import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { apiRequest } from "./apiClient";

describe("apiRequest", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  test("returns parsed data for a successful response", async () => {
    global.fetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        data: [{ insightId: "insight-1" }],
      }),
    });

    const result = await apiRequest(
      "/api/insights"
    );

    expect(result.data).toHaveLength(1);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/insights",
      expect.objectContaining({
        credentials: "include",
      })
    );
  });

  test("includes JSON and custom request headers", async () => {
    global.fetch.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        message: "created",
      }),
    });

    await apiRequest("/api/insights", {
      method: "POST",
      headers: {
        "x-request-id": "request-123",
      },
      body: JSON.stringify({
        title: "Monthly Review",
      }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/insights",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "request-123",
        },
      })
    );
  });

  test("throws Forbidden for a 403 response", async () => {
    global.fetch.mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({
        message: "Access denied",
      }),
    });

    await expect(
      apiRequest("/api/insights/private")
    ).rejects.toThrow("Forbidden");
  });

  test("throws the API-provided error message", async () => {
    global.fetch.mockResolvedValue({
      status: 400,
      ok: false,
      json: async () => ({
        message: "Title is required",
      }),
    });

    await expect(
      apiRequest("/api/insights", {
        method: "POST",
      })
    ).rejects.toThrow("Title is required");
  });

  test("uses a fallback message when the API supplies no message", async () => {
    global.fetch.mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({}),
    });

    await expect(
      apiRequest("/api/insights")
    ).rejects.toThrow("Something went wrong");
  });
});
