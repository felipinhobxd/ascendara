const fs = require("fs-extra");
const path = require("path");
const { app } = require("electron");
const { getSettingsManager } = require("./settings");

const MAX_RECOVERY_POINTS = 5;
const RECOVERY_ID_PATTERN = /^settings-\d{13}$/;

function getRecoveryDirectory() {
  return path.join(app.getPath("userData"), "recovery-points");
}

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "ascendarasettings.json");
}

function getRecoveryPath(id) {
  if (!RECOVERY_ID_PATTERN.test(String(id || ""))) {
    throw new Error("Invalid recovery point identifier");
  }

  const recoveryDirectory = getRecoveryDirectory();
  const candidate = path.join(recoveryDirectory, `${id}.json`);
  const relative = path.relative(recoveryDirectory, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Recovery point path is outside the recovery directory");
  }
  return candidate;
}

async function listRecoveryPoints() {
  const recoveryDirectory = getRecoveryDirectory();
  await fs.ensureDir(recoveryDirectory);

  const entries = await fs.readdir(recoveryDirectory);
  const points = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = entry.slice(0, -5);
    if (!RECOVERY_ID_PATTERN.test(id)) continue;

    try {
      const payload = await fs.readJson(path.join(recoveryDirectory, entry));
      if (!payload?.settings || typeof payload.settings !== "object") continue;
      points.push({
        id,
        createdAt: payload.createdAt || null,
        appVersion: payload.appVersion || null,
        reason: payload.reason || "manual",
      });
    } catch (error) {
      console.warn(`[Recovery] Ignoring unreadable recovery point ${entry}:`, error.message);
    }
  }

  return points.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function pruneRecoveryPoints() {
  const points = await listRecoveryPoints();
  const stale = points.slice(MAX_RECOVERY_POINTS);

  await Promise.all(
    stale.map(point => fs.remove(getRecoveryPath(point.id)).catch(() => {}))
  );
}

async function createRecoveryPoint(reason = "manual", appVersion = null) {
  const settingsPath = getSettingsFilePath();
  if (!(await fs.pathExists(settingsPath))) {
    throw new Error("Ascendara settings file does not exist yet");
  }

  // Read the file directly instead of using getSettings(). Sensitive fields are already
  // encrypted on disk, so the recovery copy never turns API keys into plaintext.
  const settings = await fs.readJson(settingsPath);
  const timestamp = Date.now();
  const id = `settings-${timestamp}`;
  const recoveryPath = getRecoveryPath(id);

  await fs.ensureDir(getRecoveryDirectory());
  await fs.writeJson(
    recoveryPath,
    {
      formatVersion: 1,
      id,
      createdAt: new Date(timestamp).toISOString(),
      appVersion: appVersion || null,
      reason: String(reason || "manual").slice(0, 64),
      settings,
    },
    { spaces: 2 }
  );

  await pruneRecoveryPoints();
  return { id, createdAt: new Date(timestamp).toISOString(), appVersion, reason };
}

async function restoreRecoveryPoint(id) {
  const recoveryPath = getRecoveryPath(id);
  if (!(await fs.pathExists(recoveryPath))) {
    throw new Error("Recovery point was not found");
  }

  const payload = await fs.readJson(recoveryPath);
  if (!payload?.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) {
    throw new Error("Recovery point does not contain valid Ascendara settings");
  }

  const manager = getSettingsManager();
  const restored = manager.saveSettings(payload.settings);
  if (!restored) {
    throw new Error("Ascendara could not restore the settings recovery point");
  }

  return {
    success: true,
    id,
    settings: manager.getSettings(),
  };
}

function registerRecoveryHandlers(ipcMain) {
  ipcMain.handle("create-settings-recovery-point", (_event, reason, appVersion) =>
    createRecoveryPoint(reason, appVersion)
  );

  ipcMain.handle("list-settings-recovery-points", () => listRecoveryPoints());

  ipcMain.handle("restore-settings-recovery-point", async (event, id) => {
    const result = await restoreRecoveryPoint(id);
    event.sender.send("settings-updated", result.settings);
    return result;
  });
}

module.exports = {
  MAX_RECOVERY_POINTS,
  createRecoveryPoint,
  getRecoveryDirectory,
  listRecoveryPoints,
  registerRecoveryHandlers,
  restoreRecoveryPoint,
};
