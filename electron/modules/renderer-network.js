const dns = require("dns").promises;
const https = require("https");
const net = require("net");

const ALLOWED_SERVICE_HOSTS = new Set([
  "monitor.ascendara.app",
  "api.ascendara.app",
  "cdn.ascendara.app",
  "lfs.ascendara.app",
  "r2.ascendara.app",
]);
const ALLOWED_METHODS = new Set(["GET", "HEAD"]);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;

const CUSTOM_SOURCE_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const CUSTOM_SOURCE_MAX_REDIRECTS = 4;
const CUSTOM_SOURCE_TIMEOUT_MS = 30000;
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home"];

function normalizeServiceRequest(rawUrl, options = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new TypeError("Service request URL must be a valid URL");
  }

  if (parsedUrl.protocol !== "https:" || !ALLOWED_SERVICE_HOSTS.has(parsedUrl.hostname)) {
    throw new Error(`Service request host is not allowed: ${parsedUrl.hostname || "unknown"}`);
  }

  // This bridge exists for five root health checks, not for arbitrary requests to an
  // otherwise trusted domain. Restricting the route makes that distinction enforceable.
  if (
    parsedUrl.username ||
    parsedUrl.password ||
    (parsedUrl.port && parsedUrl.port !== "443") ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error("Service request route is not allowed");
  }

  const method = String(options.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Service request method is not allowed: ${method}`);
  }

  const requestedTimeout = Number(options.timeout);
  const timeout = Number.isFinite(requestedTimeout)
    ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, requestedTimeout))
    : 5000;

  // The status checker only needs these two headers. Copying arbitrary renderer
  // headers would make this endpoint much more general than its purpose requires.
  const headers = {};
  if (typeof options.headers?.Accept === "string") {
    headers.Accept = options.headers.Accept.slice(0, 256);
  }
  if (typeof options.headers?.["X-Client"] === "string") {
    headers["X-Client"] = options.headers["X-Client"].slice(0, 128);
  }

  return { parsedUrl, method, timeout, headers };
}

function requestAscendaraService(rawUrl, options = {}) {
  const { parsedUrl, method, timeout, headers } = normalizeServiceRequest(rawUrl, options);

  return new Promise((resolve, reject) => {
    const request = https.request(
      parsedUrl,
      {
        method,
        headers,
        timeout,
      },
      response => {
        const chunks = [];
        let totalBytes = 0;

        response.on("data", chunk => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("Service response exceeded the 1 MB safety limit"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode || 0,
            statusCode: response.statusCode || 0,
            data: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Service request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function isPublicIpAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return false;

  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;

    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }

  const normalized = address.toLowerCase().split("%")[0];

  // IPv4-mapped addresses are intentionally rejected rather than decoded here. Custom
  // sources have no reason to require them, and treating them as a special case avoids
  // accidentally bypassing the IPv4 private-range checks above.
  if (normalized.startsWith("::ffff:")) return false;
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  if (normalized.startsWith("ff")) return false;
  if (normalized.startsWith("2001:db8")) return false;
  return true;
}

function normalizeCustomSourceUrl(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new TypeError("Custom source URL must be a valid URL");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("Custom sources must use HTTPS");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Custom source URLs cannot contain credentials");
  }
  if (parsedUrl.port && parsedUrl.port !== "443") {
    throw new Error("Custom sources must use the standard HTTPS port");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  ) {
    throw new Error("Custom source host is not public");
  }

  if (net.isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error("Custom source IP address is not public");
  }

  // Fragments never reach the server and can make two visually different settings hit
  // the same resource. Dropping them keeps the persisted source URL deterministic.
  parsedUrl.hash = "";
  return parsedUrl;
}

async function resolvePublicCustomSourceTarget(parsedUrl) {
  if (net.isIP(parsedUrl.hostname)) {
    if (!isPublicIpAddress(parsedUrl.hostname)) {
      throw new Error("Custom source IP address is not public");
    }
    return {
      address: parsedUrl.hostname,
      family: net.isIP(parsedUrl.hostname),
    };
  }

  const addresses = await dns.lookup(parsedUrl.hostname, {
    all: true,
    verbatim: true,
  });

  if (!addresses.length) {
    throw new Error("Custom source hostname did not resolve");
  }

  // Reject the whole hostname if DNS exposes any private target. Picking only a public
  // answer is not enough because a later lookup could choose a different address.
  const blockedAddress = addresses.find(result => !isPublicIpAddress(result.address));
  if (blockedAddress) {
    throw new Error("Custom source hostname resolves to a non-public address");
  }

  return addresses[0];
}

function createPinnedLookup(target) {
  return (_hostname, _options, callback) => {
    callback(null, target.address, target.family);
  };
}

async function requestCustomSource(rawUrl, redirectCount = 0) {
  const parsedUrl = normalizeCustomSourceUrl(rawUrl);
  const target = await resolvePublicCustomSourceTarget(parsedUrl);

  return new Promise((resolve, reject) => {
    const request = https.request(
      parsedUrl,
      {
        method: "GET",
        timeout: CUSTOM_SOURCE_TIMEOUT_MS,
        lookup: createPinnedLookup(target),
        headers: {
          Accept: "application/json, text/plain;q=0.9, */*;q=0.1",
          "User-Agent": "Ascendara/CustomSource",
          Referer: "https://ascendara.app/",
        },
      },
      response => {
        const status = response.statusCode || 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          response.resume();
          if (redirectCount >= CUSTOM_SOURCE_MAX_REDIRECTS) {
            reject(new Error("Custom source exceeded the redirect limit"));
            return;
          }

          let redirectUrl;
          try {
            redirectUrl = new URL(location, parsedUrl).toString();
          } catch {
            reject(new Error("Custom source returned an invalid redirect URL"));
            return;
          }

          // Every redirect goes through the same URL and DNS checks. This matters for
          // public URLs that try to bounce the main process toward localhost or metadata.
          requestCustomSource(redirectUrl, redirectCount + 1).then(resolve, reject);
          return;
        }

        const advertisedLength = Number(response.headers["content-length"] || 0);
        if (
          Number.isFinite(advertisedLength) &&
          advertisedLength > CUSTOM_SOURCE_MAX_RESPONSE_BYTES
        ) {
          response.resume();
          reject(new Error("Custom source response exceeds the 20 MB safety limit"));
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        let exceededLimit = false;

        response.on("data", chunk => {
          if (exceededLimit) return;
          totalBytes += chunk.length;
          if (totalBytes > CUSTOM_SOURCE_MAX_RESPONSE_BYTES) {
            exceededLimit = true;
            request.destroy(new Error("Custom source response exceeds the 20 MB safety limit"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          if (exceededLimit) return;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusCode: status,
            data: Buffer.concat(chunks).toString("utf8"),
            finalUrl: parsedUrl.toString(),
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Custom source request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function isAscendaraServiceHost(rawUrl) {
  try {
    return ALLOWED_SERVICE_HOSTS.has(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

function registerRendererNetworkHandlers(ipcMain) {
  // `request-ascendara-service` is still used by one older Custom Sources caller. Keep
  // that compatibility route safe by sending non-Ascendara hosts through the exact same
  // public-HTTPS/SSRF checks as the dedicated custom-source channel. Official service
  // hosts still use the much narrower root-only health-check policy.
  ipcMain.handle("request-ascendara-service", (_event, rawUrl, options) => {
    if (isAscendaraServiceHost(rawUrl)) {
      return requestAscendaraService(rawUrl, options);
    }
    return requestCustomSource(rawUrl);
  });

  // New code should use this channel directly. Once gameService is split into smaller
  // modules, the temporary compatibility branch above can be deleted cleanly.
  ipcMain.handle("fetch-custom-source", (_event, rawUrl) => requestCustomSource(rawUrl));
}

module.exports = {
  ALLOWED_SERVICE_HOSTS,
  isPublicIpAddress,
  normalizeCustomSourceUrl,
  normalizeServiceRequest,
  registerRendererNetworkHandlers,
  requestAscendaraService,
  requestCustomSource,
  resolvePublicCustomSourceTarget,
};
