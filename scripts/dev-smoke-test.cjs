const net = require("net");
const { spawn } = require("child_process");

const DEV_HOST = "127.0.0.1";
const DEV_PORT = 5173;
const STARTUP_TIMEOUT_MS = 30_000;
const STABILITY_WINDOW_MS = 12_000;

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
          reject(new Error(`Vite did not start on ${host}:${port} within ${timeoutMs} ms`));
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

  const electron = spawnTracked("xvfb-run", ["-a", "yarn", "electron"], "electron");
  await waitForStability(electron, STABILITY_WINDOW_MS);

  console.log(
    `Developer smoke test passed: Electron stayed alive for ${STABILITY_WINDOW_MS / 1000} seconds after startup.`
  );
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
