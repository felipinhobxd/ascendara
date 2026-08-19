const test = require("node:test");
const assert = require("node:assert/strict");
const {
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
