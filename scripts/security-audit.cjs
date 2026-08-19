const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const REPO_ROOT = path.join(__dirname, "..");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

// The official Ascendara runtime still enables Node integration in the main renderer.
// Keep these patterns visible so a future isolation migration has a real inventory, but
// do not make upstream-compatible code fail CI just because that migration is unfinished.
const NODE_COMPATIBILITY_PATTERNS = [
  {
    label: "Node process API in renderer",
    pattern:
      /\bprocess\s*\.\s*(?:env|platform|versions|argv|cwd|chdir|exit|execPath|execArgv|pid|ppid|arch|resourcesPath)\b/g,
  },
  {
    label: "Node __dirname global in renderer",
    pattern: /\b__dirname\b/g,
  },
  {
    label: "Node __filename global in renderer",
    pattern: /\b__filename\b/g,
  },
  {
    label: "Node Buffer API in renderer",
    pattern:
      /(?:\bnew\s+Buffer\s*\(|\bBuffer\s*\.\s*(?:from|alloc|allocUnsafe|concat|isBuffer|byteLength)\s*\()/g,
  },
  {
    label: "Node built-in require in renderer",
    pattern:
      /\brequire\s*\(\s*["'](?:node:)?(?:fs|fs\/promises|path|os|child_process|crypto|http|https|stream|url|util|zlib|buffer|events)["']\s*\)/g,
  },
  {
    label: "Node built-in import in renderer",
    pattern:
      /(?:from\s*|import\s*\()\s*["'](?:node:)?(?:fs|fs\/promises|path|os|child_process|crypto|http|https|stream|url|util|zlib|buffer|events)["']/g,
  },
];

// These compatibility APIs can still be reduced over time without changing Ascendara's
// public behavior. Keeping them separate from Node usage makes the report useful even
// while the fork intentionally follows the upstream BrowserWindow settings.
const BRIDGE_COMPATIBILITY_PATTERNS = [
  {
    label: "legacy custom-source request alias",
    pattern: /window\.electron\.request\s*\(/g,
  },
  {
    label: "legacy low-level IPC bridge",
    pattern: /window\.electron\.ipcRenderer\b/g,
  },
];

const enforceFutureIsolation = process.argv.includes("--enforce-isolation");

function collectSourceFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function findLineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function collectFindings(files, rules) {
  const findings = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(source))) {
        findings.push({
          rule: rule.label,
          file: path.relative(REPO_ROOT, filePath),
          line: findLineNumber(source, match.index),
        });
      }
    }
  }

  return findings;
}

function printFindings(title, findings) {
  console.log(title);
  if (findings.length === 0) {
    console.log("- none");
    return;
  }

  for (const finding of findings) {
    console.log(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
}

const sourceFiles = collectSourceFiles(ROOT);
const nodeFindings = collectFindings(sourceFiles, NODE_COMPATIBILITY_PATTERNS);
const bridgeFindings = collectFindings(sourceFiles, BRIDGE_COMPATIBILITY_PATTERNS);

printFindings("Upstream Node compatibility inventory:", nodeFindings);
printFindings("Renderer bridge compatibility inventory:", bridgeFindings);

const totalFindings = nodeFindings.length + bridgeFindings.length;
console.log(
  `Renderer compatibility inventory total: ${totalFindings} finding${totalFindings === 1 ? "" : "s"}.`
);

if (enforceFutureIsolation && totalFindings > 0) {
  console.error(
    "Future isolation enforcement failed. Resolve the inventory before changing the official renderer runtime contract."
  );
  process.exitCode = 1;
} else {
  console.log("Security compatibility audit passed.");
}
