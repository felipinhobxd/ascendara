const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPublicIpAddress,
  normalizeCustomSourceUrl,
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

test("custom sources require normal public HTTPS URLs", () => {
  assert.equal(
    normalizeCustomSourceUrl("https://example.com/list.json#latest").toString(),
    "https://example.com/list.json"
  );
  assert.throws(
    () => normalizeCustomSourceUrl("http://example.com/list.json"),
    /must use HTTPS/
  );
  assert.throws(
    () => normalizeCustomSourceUrl("https://user:pass@example.com/list.json"),
    /cannot contain credentials/
  );
  assert.throws(
    () => normalizeCustomSourceUrl("https://example.com:8443/list.json"),
    /standard HTTPS port/
  );
  assert.throws(
    () => normalizeCustomSourceUrl("https://localhost/list.json"),
    /host is not public/
  );
  assert.throws(
    () => normalizeCustomSourceUrl("https://catalog.internal/list.json"),
    /host is not public/
  );
});

test("custom source SSRF checks reject private and reserved IPv4 targets", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }

  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
});

test("custom source SSRF checks reject local IPv6 targets", () => {
  for (const address of ["::", "::1", "::ffff:127.0.0.1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }

  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});
