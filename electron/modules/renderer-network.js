const https = require("https");

const ALLOWED_SERVICE_HOSTS = new Set([
  "monitor.ascendara.app",
  "api.ascendara.app",
  "cdn.ascendara.app",
  "lfs.ascendara.app",
  "r2.ascendara.app",
]);
const ALLOWED_SERVICE_METHODS = new Set(["GET", "HEAD"]);
const MAX_SERVICE_RESPONSE_BYTES = 1024 * 1024;
const MIN_SERVICE_TIMEOUT_MS = 1000;
const MAX_SERVICE_TIMEOUT_MS = 15000;

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

  // This channel is only for Ascendara's root health checks. Keeping it narrow makes
  // status polling predictable without changing the separate External Sources behavior.
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
  if (!ALLOWED_SERVICE_METHODS.has(method)) {
    throw new Error(`Service request method is not allowed: ${method}`);
  }

  const requestedTimeout = Number(options.timeout);
  const timeout = Number.isFinite(requestedTimeout)
    ? Math.min(MAX_SERVICE_TIMEOUT_MS, Math.max(MIN_SERVICE_TIMEOUT_MS, requestedTimeout))
    : 5000;

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
          if (totalBytes > MAX_SERVICE_RESPONSE_BYTES) {
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

function normalizeExternalRequest(rawUrl, options = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new TypeError("External request URL must be a valid URL");
  }

  // The upstream preload used Node's https.request directly, so HTTPS is the actual
  // compatibility boundary. Do not add host, port, or response-size restrictions here:
  // External Sources are user-provided and can be very large or self-hosted.
  if (parsedUrl.protocol !== "https:") {
    throw new Error("External requests must use HTTPS");
  }

  const method = typeof options.method === "string" ? options.method.toUpperCase() : "GET";
  const headers =
    options.headers && typeof options.headers === "object" && !Array.isArray(options.headers)
      ? { ...options.headers }
      : {};
  const timeout = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : undefined;

  return { parsedUrl, method, headers, timeout };
}

function requestExternalResource(rawUrl, options = {}) {
  const { parsedUrl, method, headers, timeout } = normalizeExternalRequest(rawUrl, options);

  return new Promise((resolve, reject) => {
    const request = https.request(
      parsedUrl,
      {
        method,
        headers,
        ...(timeout === undefined ? {} : { timeout }),
      },
      response => {
        let data = "";

        // This intentionally mirrors the official preload helper instead of imposing a
        // small cap. Some Hydra-compatible External Sources contain hundreds of thousands
        // of entries, so an arbitrary launcher-side limit would be a compatibility bug.
        response.setEncoding("utf8");
        response.on("data", chunk => {
          data += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode || 0,
            statusCode: response.statusCode || 0,
            data,
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Request timed out"));
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
  // The preload compatibility alias still calls this channel. Keep that old contract
  // intact: Ascendara health checks take the narrow path, while external URLs behave like
  // the official preload's https.request helper until callers migrate naturally.
  ipcMain.handle("request-ascendara-service", (_event, rawUrl, options) => {
    if (isAscendaraServiceHost(rawUrl)) {
      return requestAscendaraService(rawUrl, options);
    }
    return requestExternalResource(rawUrl, options);
  });

  ipcMain.handle("request-external-resource", (_event, rawUrl, options) =>
    requestExternalResource(rawUrl, options)
  );
  ipcMain.handle("fetch-custom-source", (_event, rawUrl) =>
    requestExternalResource(rawUrl, { method: "GET" })
  );
}

module.exports = {
  ALLOWED_SERVICE_HOSTS,
  isAscendaraServiceHost,
  normalizeExternalRequest,
  normalizeServiceRequest,
  registerRendererNetworkHandlers,
  requestAscendaraService,
  requestExternalResource,
};
