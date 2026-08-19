const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAscendaraServiceHost,
  normalizeExternalRequest,
  normalizeServiceRequest,
} = require("./renderer-network");

test("renderer service requests only accept official Ascendara HTTPS hosts", () => {
  const allowed = normalizeServiceRequest("https://monitor.ascendara.app/", {
    method: "GET",
  });

  assert.equal(allowed.parsedUrl.hostname, "monitor.ascendara.app");
  assert.throws(
    () => normalizeServiceRequest("http://monitor.ascendara.app/"),
    /host is not allowed/
  );
  assert.throws(
    () => normalizeServiceRequest("https://monitor.ascendara.app.evil.example/"),
    /host is not allowed/
  );
  assert.throws(
    () => normalizeServiceRequest("https://example.com/"),
    /host is not allowed/
  );
});

test("renderer service requests only accept the exact health-check route", () => {
  assert.doesNotThrow(() => normalizeServiceRequest("https://api.ascendara.app/"));
  assert.doesNotThrow(() => normalizeServiceRequest("https://api.ascendara.app:443/"));
  assert.throws(
    () => normalizeServiceRequest("https://api.ascendara.app/health"),
    /route is not allowed/
  );
  assert.throws(
    () => normalizeServiceRequest("https://api.ascendara.app/?debug=1"),
    /route is not allowed/
  );
  assert.throws(
    () => normalizeServiceRequest("https://user:pass@api.ascendara.app/"),
    /route is not allowed/
  );
  assert.throws(
    () => normalizeServiceRequest("https://api.ascendara.app:8443/"),
    /route is not allowed/
  );
});

test("renderer service requests are read-only and clamp timeouts", () => {
  assert.equal(
    normalizeServiceRequest("https://api.ascendara.app/", {
      method: "HEAD",
      timeout: 100,
    }).timeout,
    1000
  );
  assert.equal(
    normalizeServiceRequest("https://api.ascendara.app/", {
      method: "GET",
      timeout: 60000,
    }).timeout,
    15000
  );
  assert.throws(
    () => normalizeServiceRequest("https://api.ascendara.app/", { method: "POST" }),
    /method is not allowed/
  );
});

test("renderer service requests only forward the headers needed by health checks", () => {
  const result = normalizeServiceRequest("https://cdn.ascendara.app/", {
    headers: {
      Accept: "application/json",
      "X-Client": "launcher-status-check",
      Authorization: "Bearer should-not-cross-this-boundary",
      Cookie: "also-not-forwarded",
    },
  });

  assert.deepEqual(result.headers, {
    Accept: "application/json",
    "X-Client": "launcher-status-check",
  });
});

test("external requests preserve the official HTTPS helper contract", () => {
  const result = normalizeExternalRequest("https://example.com:8443/list.json?source=custom", {
    method: "get",
    timeout: 30000,
    headers: {
      Accept: "application/json",
      "User-Agent": "Custom Source Client",
      Referer: "https://ascendara.app/",
    },
  });

  assert.equal(result.parsedUrl.hostname, "example.com");
  assert.equal(result.parsedUrl.port, "8443");
  assert.equal(result.parsedUrl.pathname, "/list.json");
  assert.equal(result.method, "GET");
  assert.equal(result.timeout, 30000);
  assert.deepEqual(result.headers, {
    Accept: "application/json",
    "User-Agent": "Custom Source Client",
    Referer: "https://ascendara.app/",
  });
});

test("external requests allow self-hosted HTTPS sources just like upstream", () => {
  const local = normalizeExternalRequest("https://127.0.0.1:9443/catalog.json", {
    method: "GET",
  });
  const lan = normalizeExternalRequest("https://catalog.internal:4443/games.json", {
    method: "GET",
  });

  assert.equal(local.parsedUrl.hostname, "127.0.0.1");
  assert.equal(local.parsedUrl.port, "9443");
  assert.equal(lan.parsedUrl.hostname, "catalog.internal");
  assert.equal(lan.parsedUrl.port, "4443");
});

test("external compatibility requests remain HTTPS-only", () => {
  assert.throws(
    () => normalizeExternalRequest("http://example.com/list.json"),
    /must use HTTPS/
  );
});

test("Ascendara service routing distinguishes official health hosts", () => {
  assert.equal(isAscendaraServiceHost("https://api.ascendara.app/"), true);
  assert.equal(isAscendaraServiceHost("https://monitor.ascendara.app/"), true);
  assert.equal(isAscendaraServiceHost("https://example.com/list.json"), false);
  assert.equal(isAscendaraServiceHost("not a url"), false);
});
