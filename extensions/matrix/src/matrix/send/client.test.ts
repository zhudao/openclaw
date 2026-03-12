import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockMatrixClient,
  matrixClientResolverMocks,
  primeMatrixClientResolverMocks,
} from "../client-resolver.test-helpers.js";

const {
  getMatrixRuntimeMock,
  getActiveMatrixClientMock,
  createMatrixClientMock,
  isBunRuntimeMock,
  resolveMatrixAuthMock,
  resolveMatrixAuthContextMock,
} = matrixClientResolverMocks;

vi.mock("../active-client.js", () => ({
  getActiveMatrixClient: (...args: unknown[]) => getActiveMatrixClientMock(...args),
}));

vi.mock("../client.js", () => ({
  createMatrixClient: (...args: unknown[]) => createMatrixClientMock(...args),
  isBunRuntime: () => isBunRuntimeMock(),
  resolveMatrixAuth: (...args: unknown[]) => resolveMatrixAuthMock(...args),
  resolveMatrixAuthContext: resolveMatrixAuthContextMock,
}));

vi.mock("../../runtime.js", () => ({
  getMatrixRuntime: () => getMatrixRuntimeMock(),
}));

let withResolvedMatrixClient: typeof import("./client.js").withResolvedMatrixClient;

describe("withResolvedMatrixClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    primeMatrixClientResolverMocks({
      resolved: {},
    });

    ({ withResolvedMatrixClient } = await import("./client.js"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a one-off client even when OPENCLAW_GATEWAY_PORT is set", async () => {
    vi.stubEnv("OPENCLAW_GATEWAY_PORT", "18799");

    const result = await withResolvedMatrixClient({ accountId: "default" }, async () => "ok");

    expect(getActiveMatrixClientMock).toHaveBeenCalledWith("default");
    expect(resolveMatrixAuthMock).toHaveBeenCalledTimes(1);
    expect(createMatrixClientMock).toHaveBeenCalledTimes(1);
    expect(createMatrixClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoBootstrapCrypto: false,
      }),
    );
    const oneOffClient = await createMatrixClientMock.mock.results[0]?.value;
    expect(oneOffClient.prepareForOneOff).toHaveBeenCalledTimes(1);
    expect(oneOffClient.stop).toHaveBeenCalledTimes(1);
    expect(result).toBe("ok");
  });

  it("reuses active monitor client when available", async () => {
    const activeClient = createMockMatrixClient();
    getActiveMatrixClientMock.mockReturnValue(activeClient);

    const result = await withResolvedMatrixClient({ accountId: "default" }, async (client) => {
      expect(client).toBe(activeClient);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(resolveMatrixAuthMock).not.toHaveBeenCalled();
    expect(createMatrixClientMock).not.toHaveBeenCalled();
    expect(activeClient.stop).not.toHaveBeenCalled();
  });

  it("uses the effective account id when auth resolution is implicit", async () => {
    resolveMatrixAuthContextMock.mockReturnValue({
      cfg: {},
      env: process.env,
      accountId: "ops",
      resolved: {},
    });
    resolveMatrixAuthMock.mockResolvedValue({
      accountId: "ops",
      homeserver: "https://matrix.example.org",
      userId: "@bot:example.org",
      accessToken: "token",
      password: undefined,
      deviceId: "DEVICE123",
      encryption: false,
    });

    await withResolvedMatrixClient({}, async () => {});

    expect(getActiveMatrixClientMock).toHaveBeenCalledWith("ops");
    expect(resolveMatrixAuthMock).toHaveBeenCalledWith({
      cfg: {},
      accountId: "ops",
    });
    expect(createMatrixClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ops",
      }),
    );
  });

  it("uses explicit cfg instead of loading runtime config", async () => {
    const explicitCfg = {
      channels: {
        matrix: {
          defaultAccount: "ops",
        },
      },
    };

    await withResolvedMatrixClient({ cfg: explicitCfg, accountId: "ops" }, async () => {});

    expect(getMatrixRuntimeMock).not.toHaveBeenCalled();
    expect(resolveMatrixAuthContextMock).toHaveBeenCalledWith({
      cfg: explicitCfg,
      accountId: "ops",
    });
    expect(resolveMatrixAuthMock).toHaveBeenCalledWith({
      cfg: explicitCfg,
      accountId: "ops",
    });
  });

  it("still stops one-off matrix clients when wrapped sends fail", async () => {
    const oneOffClient = createMockMatrixClient();
    createMatrixClientMock.mockResolvedValue(oneOffClient);

    await expect(
      withResolvedMatrixClient({ accountId: "default" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(oneOffClient.stop).toHaveBeenCalledTimes(1);
  });
});
