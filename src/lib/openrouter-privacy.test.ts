import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const load = async () => (await import("./openrouter-privacy")).providerPrivacy();

describe("providerPrivacy", () => {
  it("requires ZDR and no data collection by default", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x:y@127.0.0.1:5433/z");
    expect(await load()).toEqual({ provider: { zdr: true, data_collection: "deny" } });
  });

  it("is off only when explicitly disabled", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x:y@127.0.0.1:5433/z");
    vi.stubEnv("OPENROUTER_ZDR", "false");
    expect(await load()).toEqual({});
  });
});
