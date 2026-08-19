const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build");
const ASSETS_DIR = path.join(BUILD_DIR, "assets");
const REPORT_LIMIT = 20;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function collectFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
      continue;
    }

    const stat = fs.statSync(fullPath);
    files.push({
      file: path.relative(BUILD_DIR, fullPath),
      bytes: stat.size,
      extension: path.extname(entry.name).toLowerCase(),
    });
  }

  return files;
}

if (!fs.existsSync(ASSETS_DIR)) {
  console.error("Bundle report could not find build/assets. Run the production build first.");
  process.exitCode = 1;
} else {
  const assets = collectFiles(ASSETS_DIR);
  const codeAssets = assets.filter(asset => [".js", ".css"].includes(asset.extension));
  const sorted = [...codeAssets].sort((a, b) => b.bytes - a.bytes);
  const totalJs = codeAssets
    .filter(asset => asset.extension === ".js")
    .reduce((sum, asset) => sum + asset.bytes, 0);
  const totalCss = codeAssets
    .filter(asset => asset.extension === ".css")
    .reduce((sum, asset) => sum + asset.bytes, 0);

  console.log("Ascendara production bundle report");
  console.log(`JavaScript total: ${formatBytes(totalJs)}`);
  console.log(`CSS total:        ${formatBytes(totalCss)}`);
  console.log("");
  console.log(`Largest ${Math.min(REPORT_LIMIT, sorted.length)} code assets:`);

  for (const asset of sorted.slice(0, REPORT_LIMIT)) {
    console.log(`- ${formatBytes(asset.bytes).padStart(9)}  ${asset.file}`);
  }

  // This stage is intentionally observational. We need a few real builds before setting
  // a budget; guessing one now would turn a performance report into a fragile CI gate.
  console.log("");
  console.log("Bundle report complete. No size budget is enforced yet.");
}
