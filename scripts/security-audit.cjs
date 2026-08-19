const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const FORBIDDEN_PATTERNS = [
  {
    label: "legacy preload HTTPS request helper",
    pattern: /window\.electron\.request\s*\(/g,
  },
];

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

const findings = [];
for (const filePath of collectSourceFiles(ROOT)) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const rule of FORBIDDEN_PATTERNS) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(source))) {
      findings.push({
        rule: rule.label,
        file: path.relative(path.join(__dirname, ".."), filePath),
        line: findLineNumber(source, match.index),
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Security audit found renderer code using retired privileged bridges:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.rule})`);
  }
  process.exitCode = 1;
} else {
  console.log("Security audit passed: no retired renderer networking bridge usage found.");
}
