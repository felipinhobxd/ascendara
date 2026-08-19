const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createPreloadIpcTransport } = require("./modules/preload-bridge");

function loadPreloadApi() {
  const exposed = {};
  const ipcRenderer = {
    invoke: async () => undefined,
    on: () => {},
    removeListener: () => {},
    removeAllListeners: () => {},
  };

  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed[name] = value;
    },
  };

  const source = fs.readFileSync(path.join(__dirname, "preload.js"), "utf8");
  const sandbox = {
    console,
    process,
    window: {
      addEventListener: () => {},
    },
    document: {
      getElementById: () => null,
    },
    require(request) {
      if (request === "electron") return { contextBridge, ipcRenderer };
      if (request === "./modules/preload-bridge") return { createPreloadIpcTransport };
      throw new Error(`Unexpected preload dependency in API test: ${request}`);
    },
  };

  vm.runInNewContext(source, sandbox, {
    filename: "electron/preload.js",
  });

  return exposed;
}

test("preload exposes the critical Ascendara renderer APIs", () => {
  const exposed = loadPreloadApi();
  assert.equal(typeof exposed.electron, "object");
  assert.equal(typeof exposed.qbittorrentApi, "object");

  // This list intentionally focuses on APIs whose accidental removal would break
  // startup, updates, downloads, settings, or the Stage 3 isolation migration. It is
  // small enough to maintain without turning the test into a duplicate of preload.js.
  const requiredFunctions = [
    "getSettings",
    "saveSettings",
    "updateSetting",
    "onSettingsChanged",
    "getGames",
    "getInstalledGames",
    "downloadFile",
    "onDownloadProgress",
    "playGame",
    "openURL",
    "checkForUpdates",
    "downloadUpdate",
    "isUpdateDownloaded",
    "isBrokenVersion",
    "onTranslationProgress",
    "onUpdateDownloadProgress",
    "onSteamripCookieReceived",
    "requestAscendaraService",
    "fetchCustomSource",
  ];

  for (const name of requiredFunctions) {
    assert.equal(typeof exposed.electron[name], "function", `${name} must stay exposed`);
  }
});

test("preload still exposes qBittorrent through its dedicated namespace", () => {
  const exposed = loadPreloadApi();
  assert.equal(typeof exposed.qbittorrentApi.login, "function");
  assert.equal(typeof exposed.qbittorrentApi.getVersion, "function");
});
