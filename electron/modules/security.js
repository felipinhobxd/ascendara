const path = require("path");

const TRUSTED_AUTH_HOSTS = new Set(["accounts.google.com"]);
const TRUSTED_AUTH_SUFFIXES = [".firebaseapp.com", ".googleapis.com"];
const APP_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:46859",
  "http://127.0.0.1:46859",
]);

function parseHttpUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Keep auth popups on the providers Ascendara actually uses.
 * Substring checks are tempting here, but a URL such as
 * "https://example.com/?next=accounts.google.com" would pass them too.
 */
function isTrustedAuthUrl(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed || parsed.protocol !== "https:") return false;

  if (TRUSTED_AUTH_HOSTS.has(parsed.hostname)) return true;
  return TRUSTED_AUTH_SUFFIXES.some(suffix => parsed.hostname.endsWith(suffix));
}

/**
 * External links are handed to the user's browser. Keeping this to normal web
 * protocols prevents renderer content from turning links into file or script URLs.
 */
function isSafeExternalUrl(rawUrl) {
  return Boolean(parseHttpUrl(rawUrl));
}

/**
 * The main window should only ever render the local Vite server. OAuth and other
 * web pages belong in a hardened child window or the user's normal browser.
 */
function isAllowedAppNavigation(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  return Boolean(parsed && APP_ORIGINS.has(parsed.origin));
}

/**
 * IPC callers sometimes provide a filename. Resolve it once and make sure it did
 * not climb out of the directory we intended to expose before touching the disk.
 */
function resolveInsideDirectory(baseDirectory, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) return null;

  const basePath = path.resolve(baseDirectory);
  const resolvedPath = path.resolve(basePath, requestedPath);
  const relativePath = path.relative(basePath, resolvedPath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  ) {
    return resolvedPath;
  }

  return null;
}

/**
 * The load-error page is built from a small HTML string. Escaping Chromium's
 * diagnostic text keeps that fallback page inert even if the message changes.
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = {
  escapeHtml,
  isAllowedAppNavigation,
  isSafeExternalUrl,
  isTrustedAuthUrl,
  resolveInsideDirectory,
};
