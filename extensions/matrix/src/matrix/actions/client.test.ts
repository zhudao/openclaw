import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockMatrixClient,
  matrixClientResolverMocks,
  primeMatrixClientResolverMocks,
} from "../client-resolver.test-helpers.js";

const resolveMatrixRoomIdMock = vi.fn();

const {
  loadConfigMock,
  getMatrixRuntimeMock,
  getActiveMatrixClientMock,
  createMatrixClientMock,
  isBunRuntimeMock,
  resolveMatrixAuthMock,
  resolveMatrixAuthContextMock,
} = matrixClientResolverMocks;

vi.mock("../../runtime.js", () => ({
  getMatrixRuntime: () => getMatrixRuntimeMock(),
}));

vi.mock("../active-client.js", () => ({
  getActiveMatrixClient: getActiveMatrixClientMock,
}));

vi.mock("../client.js", () => ({
  createMatrixClient: createMatrixClientMock,
  isBunRuntime: () => isBunRuntimeMock(),
  resolveMatrixAuth: resolveMatrixAuthMock,
  resolveMatrixAuthContext: resolveMatrixAuthContextMock,
}));

vi.mock("../send.js", () => ({
  resolveMatrixRoomId: (...args: unknown[]) => resolveMatrixRoomIdMock(...args),
}));

let withResolvedActionClient: typeof import("./client.js").withResolvedActionClient;
let withResolvedRoomAction: typeof import("./client.js").withResolvedRoomAction;
let withStartedActionClient: typeof import("./client.js").withStartedActionClient;

describe("action client helpers", () => {
  beforeEach(async () => {
    vi.resetModules();
    primeMatrixClientResolverMocks();
    resolveMatrixRoomIdMock
      .mockReset()
      .mockImplementation(async (_client, roomId: string) => roomId);

    ({ withResolvedActionClient, withResolvedRoomAction, withStartedActionClient } =
      await import("./client.js"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a one-off client even when OPENCLAW_GATEWAY_PORT is set", async () => {
    vi.stubEnv("OPENCLAW_GATEWAY_PORT", "18799");

    const result = await withResolvedActionClient({ accountId: "default" }, async () => "ok");

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

  it("skips one-off room preparation when readiness is disabled", async () => {
    await withResolvedActionClient({ accountId: "default", readiness: "none" }, async () => {});

    const oneOffClient = await createMatrixClientMock.mock.results[0]?.value;
    expect(oneOffClient.prepareForOneOff).not.toHaveBeenCalled();
    expect(oneOffClient.start).not.toHaveBeenCalled();
    expect(oneOffClient.stop).toHaveBeenCalledTimes(1);
  });

  it("starts one-off clients when started readiness is required", async () => {
    await withStartedActionClient({ accountId: "default" }, async () => {});

    const oneOffClient = await createMatrixClientMock.mock.results[0]?.value;
    expect(oneOffClient.start).toHaveBeenCalledTimes(1);
    expect(oneOffClient.prepareForOneOff).not.toHaveBeenCalled();
    expect(oneOffClient.stop).not.toHaveBeenCalled();
    expect(oneOffClient.stopAndPersist).toHaveBeenCalledTimes(1);
  });

  it("reuses active monitor client when available", async () => {
    const activeClient = createMockMatrixClient();
    getActiveMatrixClientMock.mockReturnValue(activeClient);

    const result = await withResolvedActionClient({ accountId: "default" }, async (client) => {
      expect(client).toBe(activeClient);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(resolveMatrixAuthMock).not.toHaveBeenCalled();
    expect(createMatrixClientMock).not.toHaveBeenCalled();
    expect(activeClient.stop).not.toHaveBeenCalled();
  });

  it("starts active clients when started readiness is required", async () => {
    const activeClient = createMockMatrixClient();
    getActiveMatrixClientMock.mockReturnValue(activeClient);

    await withStartedActionClient({ accountId: "default" }, async (client) => {
      expect(client).toBe(activeClient);
    });

    expect(activeClient.start).toHaveBeenCalledTimes(1);
    expect(activeClient.prepareForOneOff).not.toHaveBeenCalled();
    expect(activeClient.stop).not.toHaveBeenCalled();
    expect(activeClient.stopAndPersist).not.toHaveBeenCalled();
  });

  it("uses the implicit resolved account id for active client lookup and storage", async () => {
    loadConfigMock.mockReturnValue({
      channels: {
        matrix: {
          accounts: {
            ops: {
              homeserver: "https://ops.example.org",
              userId: "@ops:example.org",
              accessToken: "ops-token",
            },
          },
        },
      },
    });
    resolveMatrixAuthContextMock.mockReturnValue({
      cfg: loadConfigMock(),
      env: process.env,
      accountId: "ops",
      resolved: {
        homeserver: "https://ops.example.org",
        userId: "@ops:example.org",
        accessToken: "ops-token",
        deviceId: "OPSDEVICE",
        encryption: true,
      },
    });
    resolveMatrixAuthMock.mockResolvedValue({
      accountId: "ops",
      homeserver: "https://ops.example.org",
      userId: "@ops:example.org",
      accessToken: "ops-token",
      password: undefined,
      deviceId: "OPSDEVICE",
      encryption: true,
    });

    await withResolvedActionClient({}, async () => {});

    expect(getActiveMatrixClientMock).toHaveBeenCalledWith("ops");
    expect(resolveMatrixAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ops",
      }),
    );
    expect(createMatrixClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "ops",
        homeserver: "https://ops.example.org",
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

    await withResolvedActionClient({ cfg: explicitCfg, accountId: "ops" }, async () => {});

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

  it("stops one-off action clients after wrapped calls succeed", async () => {
    const oneOffClient = createMockMatrixClient();
    createMatrixClientMock.mockResolvedValue(oneOffClient);

    const result = await withResolvedActionClient({ accountId: "default" }, async (client) => {
      expect(client).toBe(oneOffClient);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(oneOffClient.stop).toHaveBeenCalledTimes(1);
    expect(oneOffClient.stopAndPersist).not.toHaveBeenCalled();
  });

  it("still stops one-off action clients when the wrapped call throws", async () => {
    const oneOffClient = createMockMatrixClient();
    createMatrixClientMock.mockResolvedValue(oneOffClient);

    await expect(
      withResolvedActionClient({ accountId: "default" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(oneOffClient.stop).toHaveBeenCalledTimes(1);
    expect(oneOffClient.stopAndPersist).not.toHaveBeenCalled();
  });

  it("resolves room ids before running wrapped room actions", async () => {
    const oneOffClient = createMockMatrixClient();
    createMatrixClientMock.mockResolvedValue(oneOffClient);
    resolveMatrixRoomIdMock.mockResolvedValue("!room:example.org");

    const result = await withResolvedRoomAction(
      "room:#ops:example.org",
      { accountId: "default" },
      async (client, resolvedRoom) => {
        expect(client).toBe(oneOffClient);
        return resolvedRoom;
      },
    );

    expect(resolveMatrixRoomIdMock).toHaveBeenCalledWith(oneOffClient, "room:#ops:example.org");
    expect(result).toBe("!room:example.org");
    expect(oneOffClient.stop).toHaveBeenCalledTimes(1);
  });
});
