const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const REPO_ROOT = path.join(__dirname, "..");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

// Node integration is disabled in the main renderer now, so executable Node access is
// no longer migration debt: reintroducing it would create code that only works when the
// emergency legacy flag is enabled. Keep these patterns focused on actual Node syntax so
// normal prose such as "main process." in comments does not create false failures.
const FORBIDDEN_PATTERNS = [
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

// These compatibility APIs are still being removed caller-by-caller. They remain visible
// in every build log, and --enforce-isolation turns the inventory into a hard gate once
// we are ready to delete the compatibility object from preload entirely.
const MIGRATION_PATTERNS = [
  {
    label: "legacy custom-source request alias",
    pattern: /window\.electron\.request\s*\(/g,
  },
  {
    label: "legacy low-level IPC bridge",
    pattern: /window\.electron\.ipcRenderer\b/g,
  },
];

const enforceIsolation = process.argv.includes("--enforce-isolation");

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
const forbiddenFindings = collectFindings(sourceFiles, FORBIDDEN_PATTERNS);
const migrationFindings = collectFindings(sourceFiles, MIGRATION_PATTERNS);

if (forbiddenFindings.length > 0) {
  console.error("Security audit found renderer code that depends on Node integration:");
  for (const finding of forbiddenFindings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
  process.exitCode = 1;
}

printFindings("Renderer compatibility inventory:", migrationFindings);
console.log(
  `Renderer compatibility inventory total: ${migrationFindings.length} finding${migrationFindings.length === 1 ? "" : "s"}.`
);

if (enforceIsolation && migrationFindings.length > 0) {
  console.error(
    "Renderer isolation enforcement failed. Migrate the findings above before removing compatibility bridges."
  );
  process.exitCode = 1;
}

if (forbiddenFindings.length === 0 && (!enforceIsolation || migrationFindings.length === 0)) {
  console.log("Security audit passed.");
}
