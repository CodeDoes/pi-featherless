import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerFeatherlessProvider from "./index";

describe("Featherless provider extension", () => {
  it("should register the featherless provider", async () => {
    const mockPi = {
      registerProvider: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    await registerFeatherlessProvider(mockPi);

    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      "featherless",
      expect.objectContaining({
        baseUrl: "https://api.featherless.ai/v1",
        api: "openai-completions",
        headers: expect.objectContaining({
          "HTTP-Referer": "https://pi.dev",
          "X-Title": "@kit/pi-featherless",
        }),
      })
    );
  });

  it("should inject X-Featherless-Concurrency-Slot into headers", async () => {
    const mockPi = {
      registerProvider: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    // Set env var for testing
    process.env.FEATHERLESS_CONCURRENCY_SLOT = "test-slot";

    await registerFeatherlessProvider(mockPi);

    // Get the before_provider_request listener
    const onCall = (mockPi.on as any).mock.calls.find(
      (call: any) => call[0] === "before_provider_request"
    );
    expect(onCall).toBeDefined();

    const listener = onCall[1];
    const event = {
      model: { provider: "featherless" },
      payload: { headers: {} },
    };

    listener(event, {});

    expect(event.payload.headers).toHaveProperty(
      "X-Featherless-Concurrency-Slot",
      "test-slot"
    );

    // Cleanup env var
    delete process.env.FEATHERLESS_CONCURRENCY_SLOT;
  });

  it("should NOT inject concurrency slot for other providers", async () => {
    const mockPi = {
      registerProvider: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    process.env.FEATHERLESS_CONCURRENCY_SLOT = "test-slot";
    await registerFeatherlessProvider(mockPi);

    const onCall = (mockPi.on as any).mock.calls.find(
      (call: any) => call[0] === "before_provider_request"
    );
    const listener = onCall[1];
    
    const event = {
      model: { provider: "openai" },
      payload: { headers: {} },
    };

    listener(event, {});

    expect(event.payload.headers).not.toHaveProperty(
      "X-Featherless-Concurrency-Slot"
    );

    delete process.env.FEATHERLESS_CONCURRENCY_SLOT;
  });
});
