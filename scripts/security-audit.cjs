const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const REPO_ROOT = path.join(__dirname, "..");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

// Patterns only belong here after their compatibility path is completely gone. Keeping
// this list small prevents CI from claiming something is retired while a real feature
// still needs a controlled migration path.
const FORBIDDEN_PATTERNS = [];

// These are not all bugs by themselves. They are the remaining things that can keep
// the renderer tied to Node integration or to compatibility bridges. The report lets
// us migrate them deliberately instead of flipping Electron flags blindly.
const MIGRATION_PATTERNS = [
  {
    label: "legacy custom-source request alias",
    pattern: /window\.electron\.request\s*\(/g,
  },
  {
    label: "legacy low-level IPC bridge",
    pattern: /window\.electron\.ipcRenderer\b/g,
  },
  {
    label: "CommonJS require in renderer",
    pattern: /\brequire\s*\(/g,
  },
  {
    label: "Node process global in renderer",
    pattern: /\bprocess\s*\./g,
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
    label: "Node Buffer global in renderer",
    pattern: /\bBuffer\b/g,
  },
  {
    label: "Node built-in import in renderer",
    pattern:
      /(?:from\s*|import\s*\()\s*["'](?:node:)?(?:fs|fs\/promises|path|os|child_process|crypto|http|https|stream|url|util|zlib|buffer|events)["']/g,
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
  console.error("Security audit found renderer code using retired privileged bridges:");
  for (const finding of forbiddenFindings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
  process.exitCode = 1;
}

printFindings("Renderer isolation inventory:", migrationFindings);
console.log(
  `Renderer isolation inventory total: ${migrationFindings.length} finding${migrationFindings.length === 1 ? "" : "s"}.`
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
