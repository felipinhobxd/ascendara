const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  escapeHtml,
  getIpcSenderUrl,
  installIpcMainGuard,
  isAllowedAppNavigation,
  isSafeExternalUrl,
  isTrustedAuthUrl,
  isTrustedIpcSender,
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

test("IPC sender checks prefer the calling frame over the WebContents URL", () => {
  const trustedEvent = {
    senderFrame: { url: "http://localhost:46859/#/library" },
    sender: { getURL: () => "https://example.com" },
  };
  const remoteFrameEvent = {
    senderFrame: { url: "https://example.com/embedded" },
    sender: { getURL: () => "http://localhost:46859/#/library" },
  };

  assert.equal(getIpcSenderUrl(trustedEvent), "http://localhost:46859/#/library");
  assert.equal(isTrustedIpcSender(trustedEvent), true);
  assert.equal(isTrustedIpcSender(remoteFrameEvent), false);
});

test("the ipcMain guard protects handlers registered after startup", () => {
  const registered = new Map();
  const registeredOnce = new Map();
  const blocked = [];
  const ipcMain = {
    handle: (channel, listener) => registered.set(channel, listener),
    handleOnce: (channel, listener) => registeredOnce.set(channel, listener),
  };

  installIpcMainGuard(ipcMain, {
    onBlocked: details => blocked.push(details),
  });

  ipcMain.handle("example", (_event, value) => `handled:${value}`);
  ipcMain.handleOnce("example-once", () => "once");

  const localEvent = {
    senderFrame: { url: "http://127.0.0.1:5173/#/home" },
  };
  const remoteEvent = {
    senderFrame: { url: "https://example.com" },
  };

  assert.equal(registered.get("example")(localEvent, "ok"), "handled:ok");
  assert.equal(registeredOnce.get("example-once")(localEvent), "once");
  assert.throws(
    () => registered.get("example")(remoteEvent, "blocked"),
    /Blocked IPC channel "example"/
  );
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].senderUrl, "https://example.com");
});

test("installing the ipcMain guard twice does not double-wrap handlers", () => {
  let registrationCount = 0;
  const ipcMain = {
    handle: () => {
      registrationCount += 1;
    },
  };

  installIpcMainGuard(ipcMain);
  const firstHandle = ipcMain.handle;
  installIpcMainGuard(ipcMain);

  assert.equal(ipcMain.handle, firstHandle);
  ipcMain.handle("example", () => true);
  assert.equal(registrationCount, 1);
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
