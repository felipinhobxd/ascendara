const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  escapeHtml,
  isAllowedAppNavigation,
  isSafeExternalUrl,
  isTrustedAuthUrl,
  resolveInsideDirectory,
} = require("./security");

test("auth popups only accept HTTPS on known Google and Firebase hosts", () => {
  assert.equal(isTrustedAuthUrl("https://accounts.google.com/o/oauth2/v2/auth"), true);
  assert.equal(isTrustedAuthUrl("https://project.firebaseapp.com/__/auth/handler"), true);
  assert.equal(isTrustedAuthUrl("https://identitytoolkit.googleapis.com/example"), true);
  assert.equal(isTrustedAuthUrl("http://accounts.google.com/o/oauth2/v2/auth"), false);
  assert.equal(isTrustedAuthUrl("https://example.com/?next=accounts.google.com"), false);
  assert.equal(isTrustedAuthUrl("https://firebaseapp.com.evil.example"), false);
});

test("external links are limited to HTTP and HTTPS", () => {
  assert.equal(isSafeExternalUrl("https://ascendara.app"), true);
  assert.equal(isSafeExternalUrl("http://localhost:46859"), true);
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
});

test("the main window stays on Ascendara local origins", () => {
  assert.equal(isAllowedAppNavigation("http://localhost:46859/#/library"), true);
  assert.equal(isAllowedAppNavigation("http://127.0.0.1:5173/#/home"), true);
  assert.equal(isAllowedAppNavigation("https://ascendara.app"), false);
  assert.equal(isAllowedAppNavigation("file:///tmp/index.html"), false);
});

test("local file helpers cannot escape their assigned directory", () => {
  const baseDirectory = path.join(path.sep, "tmp", "ascendara-public");

  assert.equal(
    resolveInsideDirectory(baseDirectory, "sounds/complete.mp3"),
    path.join(baseDirectory, "sounds", "complete.mp3")
  );
  assert.equal(resolveInsideDirectory(baseDirectory, "../settings.json"), null);
  assert.equal(resolveInsideDirectory(baseDirectory, path.join(path.sep, "tmp", "secret.txt")), null);
});

test("HTML escaping keeps diagnostic text from becoming markup", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
});
