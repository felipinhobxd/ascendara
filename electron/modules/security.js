const path = require("path");

const TRUSTED_AUTH_HOSTS = new Set(["accounts.google.com"]);
const TRUSTED_AUTH_SUFFIXES = [".firebaseapp.com", ".googleapis.com"];
const APP_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:46859",
  "http://127.0.0.1:46859",
]);

// ipcMain is a singleton in Electron, but keeping this as a WeakSet makes the guard
// safe to call from startup code more than once without wrapping handlers repeatedly.
const guardedIpcMainInstances = new WeakSet();

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
 * Prefer the frame URL because an iframe can share the same WebContents as the main
 * page. Falling back to sender.getURL() keeps this compatible with older event shapes.
 */
function getIpcSenderUrl(event) {
  if (typeof event?.senderFrame?.url === "string" && event.senderFrame.url) {
    return event.senderFrame.url;
  }

  try {
    return event?.sender?.getURL?.() || "";
  } catch {
    return "";
  }
}

/**
 * Privileged IPC is only valid from Ascendara's own local renderer. This check is
 * deliberately independent of the channel so a newly added handler is protected by
 * default instead of relying on every feature author remembering to add a guard.
 */
function isTrustedIpcSender(event) {
  return isAllowedAppNavigation(getIpcSenderUrl(event));
}

function createTrustedIpcListener(channel, listener, onBlocked) {
  if (typeof listener !== "function") {
    throw new TypeError(`IPC handler for "${channel}" must be a function`);
  }

  return (event, ...args) => {
    if (!isTrustedIpcSender(event)) {
      const senderUrl = getIpcSenderUrl(event) || "unknown";
      const error = new Error(`Blocked IPC channel "${channel}" from an untrusted renderer`);

      if (typeof onBlocked === "function") {
        onBlocked({ channel, senderUrl, error });
      } else {
        console.warn(`[Security] ${error.message}: ${senderUrl}`);
      }

      throw error;
    }

    return listener(event, ...args);
  };
}

/**
 * Wrap Electron's handle APIs once, before feature modules register their channels.
 * Centralizing this here means old and future handlers get sender validation without
 * a risky all-at-once rewrite of every IPC module.
 */
function installIpcMainGuard(ipcMain, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new TypeError("A valid Electron ipcMain instance is required");
  }

  if (guardedIpcMainInstances.has(ipcMain)) return ipcMain;

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    originalHandle(channel, createTrustedIpcListener(channel, listener, options.onBlocked));

  if (typeof ipcMain.handleOnce === "function") {
    const originalHandleOnce = ipcMain.handleOnce.bind(ipcMain);
    ipcMain.handleOnce = (channel, listener) =>
      originalHandleOnce(
        channel,
        createTrustedIpcListener(channel, listener, options.onBlocked)
      );
  }

  guardedIpcMainInstances.add(ipcMain);
  return ipcMain;
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
  createTrustedIpcListener,
  escapeHtml,
  getIpcSenderUrl,
  installIpcMainGuard,
  isAllowedAppNavigation,
  isSafeExternalUrl,
  isTrustedAuthUrl,
  isTrustedIpcSender,
  resolveInsideDirectory,
};
