const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const Module = require("module");

const recoveryModulePath = path.join(__dirname, "recovery.js");

async function loadRecoveryModule() {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ascendara-recovery-test-"));
  const manager = {
    savedSettings: null,
    saveSettings(settings) {
      this.savedSettings = settings;
      return true;
    },
    getSettings() {
      return this.savedSettings;
    },
  };

  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath: () => tempDirectory,
          quit: () => {},
        },
      };
    }

    if (request === "./settings" && parent?.filename === recoveryModulePath) {
      return { getSettingsManager: () => manager };
    }

    if (request === "./config" && parent?.filename === recoveryModulePath) {
      return {
        appBranch: "live",
        appVersion: "10.7.3",
        isWindows: true,
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[recoveryModulePath];
  let recovery;
  try {
    recovery = require(recoveryModulePath);
  } finally {
    Module._load = originalLoad;
  }

  return {
    recovery,
    manager,
    tempDirectory,
    cleanup: async () => {
      delete require.cache[recoveryModulePath];
      await fs.remove(tempDirectory);
    },
  };
}

test("settings recovery points preserve the encrypted on-disk settings payload", async () => {
  const context = await loadRecoveryModule();
  try {
    const settings = {
      language: "en",
      theme: "purple",
      // SettingsManager stores sensitive values encrypted. The recovery layer must copy
      // the disk representation rather than materializing decrypted secrets in browser state.
      torboxApiKey: "encrypted:payload",
    };
    await fs.writeJson(path.join(context.tempDirectory, "ascendarasettings.json"), settings);

    const point = await context.recovery.createRecoveryPoint("test", "10.7.3");
    const recoveryFile = path.join(
      context.tempDirectory,
      "recovery-points",
      `${point.id}.json`
    );
    const payload = await fs.readJson(recoveryFile);

    assert.deepEqual(payload.settings, settings);
    assert.equal(payload.reason, "test");
    assert.equal(payload.appVersion, "10.7.3");
  } finally {
    await context.cleanup();
  }
});

test("recovery points can be listed and restored through the settings manager", async () => {
  const context = await loadRecoveryModule();
  try {
    const settings = { language: "pt", theme: "blue" };
    await fs.writeJson(path.join(context.tempDirectory, "ascendarasettings.json"), settings);

    const point = await context.recovery.createRecoveryPoint("manual", "10.7.3");
    const points = await context.recovery.listRecoveryPoints();
    assert.equal(points.length, 1);
    assert.equal(points[0].id, point.id);

    const result = await context.recovery.restoreRecoveryPoint(point.id);
    assert.equal(result.success, true);
    assert.deepEqual(context.manager.savedSettings, settings);
  } finally {
    await context.cleanup();
  }
});

test("recovery identifiers cannot escape the recovery directory", async () => {
  const context = await loadRecoveryModule();
  try {
    await assert.rejects(
      () => context.recovery.restoreRecoveryPoint("../ascendarasettings"),
      /Invalid recovery point identifier/
    );
  } finally {
    await context.cleanup();
  }
});

test("rollback version comparison only treats older semantic versions as previous", async () => {
  const context = await loadRecoveryModule();
  try {
    assert.equal(context.recovery.compareVersions("10.7.2", "10.7.3"), -1);
    assert.equal(context.recovery.compareVersions("v10.7.3", "10.7.3"), 0);
    assert.equal(context.recovery.compareVersions("10.8.0", "10.7.3"), 1);
    assert.equal(context.recovery.compareVersions("9.9.9", "10.0.0"), -1);
  } finally {
    await context.cleanup();
  }
});
