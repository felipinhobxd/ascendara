const test = require("node:test");
const assert = require("node:assert/strict");
const {
  STRICT_LEGACY_IPC_ENV,
  createPreloadIpcTransport,
  validateIpcChannel,
} = require("./preload-bridge");

function createMockIpcRenderer() {
  const calls = [];
  const listeners = new Map();

  return {
    calls,
    listeners,
    invoke(channel, ...args) {
      calls.push({ channel, args });
      return Promise.resolve({ channel, args });
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    removeAllListeners(channel) {
      listeners.delete(channel);
    },
  };
}

function withStrictLegacyMode(enabled, callback) {
  const previous = process.env[STRICT_LEGACY_IPC_ENV];
  if (enabled) process.env[STRICT_LEGACY_IPC_ENV] = "1";
  else delete process.env[STRICT_LEGACY_IPC_ENV];

  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[STRICT_LEGACY_IPC_ENV];
    else process.env[STRICT_LEGACY_IPC_ENV] = previous;
  }
}

test("IPC channel validation rejects unexpected characters", () => {
  assert.equal(validateIpcChannel("download-progress"), "download-progress");
  assert.equal(validateIpcChannel("qbittorrent:login"), "qbittorrent:login");
  assert.throws(() => validateIpcChannel("../../settings"), /IPC channel names/);
  assert.throws(() => validateIpcChannel("channel with spaces"), /IPC channel names/);
});

test("named preload transport remains available in strict migration mode", async () => {
  const ipcRenderer = createMockIpcRenderer();
  const transport = createPreloadIpcTransport(ipcRenderer);

  await withStrictLegacyMode(true, () => transport.invoke("get-settings"));

  assert.deepEqual(ipcRenderer.calls, [{ channel: "get-settings", args: [] }]);
});

test("strict migration mode blocks generic legacy invoke calls", () => {
  const ipcRenderer = createMockIpcRenderer();
  const transport = createPreloadIpcTransport(ipcRenderer);

  withStrictLegacyMode(true, () => {
    assert.throws(
      () => transport.legacy.invoke("get-settings"),
      /legacy renderer IPC bridge/
    );
  });

  assert.equal(ipcRenderer.calls.length, 0);
});

test("strict migration mode blocks legacy event subscriptions", () => {
  const ipcRenderer = createMockIpcRenderer();
  const transport = createPreloadIpcTransport(ipcRenderer);

  withStrictLegacyMode(true, () => {
    assert.throws(
      () => transport.legacy.on("download-progress", () => {}),
      /legacy renderer IPC bridge/
    );
  });

  assert.equal(ipcRenderer.listeners.size, 0);
});

test("legacy subscriptions still clean up correctly outside strict mode", () => {
  const ipcRenderer = createMockIpcRenderer();
  const transport = createPreloadIpcTransport(ipcRenderer);
  const callback = () => {};

  withStrictLegacyMode(false, () => {
    const unsubscribe = transport.legacy.on("download-progress", callback);
    assert.equal(ipcRenderer.listeners.has("download-progress"), true);
    unsubscribe();
  });

  assert.equal(ipcRenderer.listeners.has("download-progress"), false);
});
