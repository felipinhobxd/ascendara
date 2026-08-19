const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const electronDirectory = path.join(projectRoot, "node_modules", "electron");
const electronInstallScript = path.join(electronDirectory, "install.js");
const electronPathFile = path.join(electronDirectory, "path.txt");

function hasInstalledElectronBinary() {
  if (!fs.existsSync(electronPathFile)) return false;

  const relativeBinaryPath = fs.readFileSync(electronPathFile, "utf8").trim();
  if (!relativeBinaryPath) return false;

  return fs.existsSync(path.join(electronDirectory, "dist", relativeBinaryPath));
}

if (!fs.existsSync(electronInstallScript)) {
  console.error(
    "Electron's install script is missing. Run yarn install before trying to start Ascendara."
  );
  process.exit(1);
}

if (hasInstalledElectronBinary()) {
  console.log("Electron binary is already installed.");
  process.exit(0);
}

console.log("Installing the Electron binary required by Ascendara...");

const result = spawnSync(process.execPath, [electronInstallScript], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("Failed to start Electron's official installer:", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status || 1);
}

if (!hasInstalledElectronBinary()) {
  console.error("Electron's installer finished, but the expected binary was not found.");
  process.exit(1);
}

console.log("Electron binary installed successfully.");
