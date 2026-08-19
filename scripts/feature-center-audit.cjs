const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    failures.push(`Missing required file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function expectContains(relativePath, needles) {
  const content = read(relativePath);
  for (const needle of needles) {
    if (!content.includes(needle)) {
      failures.push(`${relativePath} is missing expected integration: ${needle}`);
    }
  }
}

const eventModule = "src/lib/featureCenterEvents.js";
const eventNames = [
  "ascendara:open-system-center",
  "ascendara:open-game-profiles",
  "ascendara:open-smart-collections",
];

// Keep event names in one module so a rename cannot silently split producers and consumers.
function walk(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walk(fullPath));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) results.push(fullPath);
  }
  return results;
}

for (const filePath of walk(path.join(root, "src"))) {
  const relativePath = path.relative(root, filePath).split(path.sep).join("/");
  if (relativePath === eventModule) continue;
  const content = fs.readFileSync(filePath, "utf8");
  for (const eventName of eventNames) {
    if (content.includes(eventName)) {
      failures.push(`${relativePath} hardcodes ${eventName}; use FEATURE_CENTER_EVENTS instead`);
    }
  }
  if (relativePath.includes("components/") && relativePath.includes("Center") && content.includes("window.location.hash")) {
    failures.push(`${relativePath} bypasses React Router with window.location.hash`);
  }
}

expectContains("src/i18n.js", ["featureCenterResources", "addResourceBundle"]);
expectContains("src/i18n/featureCenterResources.js", ["featureCenters", "en:", "pt:"]);
expectContains("src/components/GlobalSearch.jsx", [
  "GameProfilesCenter",
  "SmartCollectionsCenter",
  "SystemCenter",
  "item.keywords",
  "item.featured",
]);
expectContains("src/hooks/useGlobalSearch.js", [
  "useCommandPaletteRegistration",
  "useRecoveryPointOnUpdate",
]);
expectContains("src/components/SystemCenter.jsx", [
  "FeatureCenterDialog",
  "useFeatureCenterDialog",
  "systemHealthService",
]);
expectContains("src/components/GameProfilesCenter.jsx", [
  "FeatureCenterDialog",
  "useFeatureCenterDialog",
  "gameProfileService",
  "isDirty",
]);
expectContains("src/components/SmartCollectionsCenter.jsx", [
  "FeatureCenterDialog",
  "useFeatureCenterDialog",
  "smartCollectionsService",
  "searchPlaceholder",
]);
expectContains("src/services/gameProfileService.js", ["umuSetGameId(gameName, profile.umuId.trim())"]);
expectContains("src/hooks/useCommandPaletteRegistration.js", ["startPreviousVersionRollback"]);

if (failures.length > 0) {
  console.error("Feature center audit failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Feature center audit passed.");
