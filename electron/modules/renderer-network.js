const https = require("https");

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

function registerRendererNetworkHandlers(ipcMain) {
  // Keep this API intentionally narrow. It exists for Ascendara's health checks,
  // not as a general-purpose way for renderer code to bypass browser networking.
  ipcMain.handle("request-ascendara-service", (_event, rawUrl, options) =>
    requestAscendaraService(rawUrl, options)
  );
}

module.exports = {
  ALLOWED_SERVICE_HOSTS,
  normalizeServiceRequest,
  registerRendererNetworkHandlers,
  requestAscendaraService,
};
