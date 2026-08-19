const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const DEV_HOST = "127.0.0.1";
const DEV_PORT = 5173;
const DEBUG_PORT = 9223;
const STARTUP_TIMEOUT_MS = 30_000;
const RENDERER_TIMEOUT_MS = 25_000;
const STABILITY_WINDOW_MS = 5_000;

const children = new Set();
let cleaningUp = false;

function log(prefix, chunk) {
  const text = String(chunk).trimEnd();
  if (!text) return;
  for (const line of text.split("\n")) {
    console.log(`[${prefix}] ${line}`);
  }
}

function spawnTracked(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // CI runs without a real desktop session. Electron still needs a predictable
      // environment while Xvfb provides the display used by the smoke test.
      CI: "true",
      ELECTRON_ENABLE_LOGGING: "1",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.add(child);
  child.stdout.on("data", chunk => log(label, chunk));
  child.stderr.on("data", chunk => log(label, chunk));
  child.once("close", () => children.delete(child));
  return child;
}

function waitForPort(host, port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(1000);

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      const retry = () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Port ${host}:${port} did not open within ${timeoutMs} ms`));
          return;
        }
        setTimeout(tryConnect, 250);
      };

      socket.once("error", retry);
      socket.once("timeout", retry);
    };

    tryConnect();
  });
}

async function waitForRendererTarget(timeoutMs) {
  const startedAt = Date.now();
  const expectedOrigin = `http://${DEV_HOST}:${DEV_PORT}`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://${DEV_HOST}:${DEBUG_PORT}/json`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(
          item =>
            item.type === "page" &&
            typeof item.url === "string" &&
            item.url.startsWith(expectedOrigin) &&
            item.webSocketDebuggerUrl
        );
        if (target) return target;
      }
    } catch {
      // The debugging endpoint starts a little after the Electron process. Retrying is
      // expected here and keeps the failure message focused on the real timeout.
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error("Electron renderer did not expose a debuggable Ascendara page in time");
}

function connectToRenderer(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    const exceptions = [];
    let nextId = 1;

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out while connecting to the Electron renderer"));
    }, 5000);

    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve({
        exceptions,
        close: () => socket.close(),
        call(method, params = {}) {
          return new Promise((callResolve, callReject) => {
            const id = nextId++;
            pending.set(id, { resolve: callResolve, reject: callReject });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });

    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails;
        exceptions.push(
          details?.exception?.description ||
            details?.text ||
            "Unknown uncaught renderer exception"
        );
        return;
      }

      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);

      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not connect to the Electron renderer debugging socket"));
    });
  });
}

async function evaluate(renderer, expression) {
  const response = await renderer.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "Renderer evaluation failed"
    );
  }

  return response.result?.value;
}

async function waitForHealthyRenderer(renderer, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await evaluate(
      renderer,
      `(() => {
        const root = document.getElementById("root");
        return {
          readyState: document.readyState,
          rootChildren: root ? root.childElementCount : 0,
          electronBridge: typeof window.electron,
          lowLevelBridge: typeof window.electron?.ipcRenderer,
          getSettings: typeof window.electron?.getSettings,
          getGames: typeof window.electron?.getGames,
          href: window.location.href,
        };
      })()`
    );

    if (
      lastState?.readyState === "complete" &&
      lastState.rootChildren > 0 &&
      lastState.electronBridge === "object" &&
      lastState.getSettings === "function" &&
      lastState.getGames === "function"
    ) {
      return lastState;
    }

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  throw new Error(`Renderer never became healthy. Last state: ${JSON.stringify(lastState)}`);
}

function waitForStability(child, durationMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      resolve();
    }, durationMs);

    child.once("exit", (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      reject(
        new Error(
          `Electron exited during the startup smoke window (code=${code}, signal=${signal || "none"})`
        )
      );
    });
  });
}

function stopChild(child, signal = "SIGTERM") {
  if (!child || child.killed) return;

  try {
    // Both Vite and Electron create child processes. Killing the process group keeps
    // the GitHub runner clean instead of leaving a dev server behind after the test.
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function cleanup() {
  if (cleaningUp) return;
  cleaningUp = true;

  for (const child of [...children]) {
    stopChild(child, "SIGTERM");
  }

  await new Promise(resolve => setTimeout(resolve, 800));

  for (const child of [...children]) {
    stopChild(child, "SIGKILL");
  }
}

async function main() {
  console.log("Starting Ascendara developer smoke test...");

  const vite = spawnTracked("yarn", ["dev", "--host", DEV_HOST], "vite");
  vite.once("exit", code => {
    if (!cleaningUp && code !== 0) {
      console.error(`Vite exited unexpectedly with code ${code}.`);
    }
  });

  await waitForPort(DEV_HOST, DEV_PORT, STARTUP_TIMEOUT_MS);
  console.log("Vite is ready. Launching Electron under Xvfb...");

  const electronBinary = path.join(process.cwd(), "node_modules", ".bin", "electron");
  const electron = spawnTracked(
    "xvfb-run",
    [
      "-a",
      electronBinary,
      "--no-sandbox",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--remote-debugging-address=${DEV_HOST}`,
      "./electron/app.js",
    ],
    "electron"
  );

  await waitForPort(DEV_HOST, DEBUG_PORT, RENDERER_TIMEOUT_MS);
  const target = await waitForRendererTarget(RENDERER_TIMEOUT_MS);
  const renderer = await connectToRenderer(target.webSocketDebuggerUrl);

  try {
    await renderer.call("Runtime.enable");
    const state = await waitForHealthyRenderer(renderer, RENDERER_TIMEOUT_MS);

    // The official app still enables Node integration in the main renderer. The smoke
    // test deliberately follows that upstream contract and verifies the bridge/IPC path
    // instead of treating a future isolation migration as if it were already complete.
    const settingsProbe = await evaluate(
      renderer,
      `window.electron.getSettings().then(settings => ({
        ok: !!settings && typeof settings === "object",
        hasLanguage: typeof settings?.language === "string",
      }))`
    );

    if (!settingsProbe?.ok) {
      throw new Error("Renderer preload IPC probe failed: getSettings() did not return settings");
    }

    await waitForStability(electron, STABILITY_WINDOW_MS);

    if (renderer.exceptions.length > 0) {
      throw new Error(
        `Uncaught renderer exception(s):\n${renderer.exceptions.map(error => `- ${error}`).join("\n")}`
      );
    }

    console.log(
      `Developer smoke test passed: React mounted, the official preload contract is available, IPC returned settings, and Electron stayed stable for ${STABILITY_WINDOW_MS / 1000} seconds.`
    );
  } finally {
    renderer.close();
  }
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});

main()
  .then(cleanup)
  .catch(async error => {
    console.error(`Developer smoke test failed: ${error.stack || error.message}`);
    await cleanup();
    process.exitCode = 1;
  });
