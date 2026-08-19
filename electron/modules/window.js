/*
 * Window Management Module
 * Handles window creation, visibility, and related operations
 */

const { BrowserWindow, screen, ipcMain, dialog, app, shell } = require("electron");
const path = require("path");
const { isDev } = require("./config");
const { initializeDiscordRPC, destroyDiscordRPC } = require("./discord-rpc");
const { getSettingsManager } = require("./settings");
const {
  escapeHtml,
  isAllowedAppNavigation,
  isSafeExternalUrl,
  isTrustedAuthUrl,
  resolveInsideDirectory,
} = require("./security");

let mainWindowHidden = false;
let isHandlingProtocolUrl = false;

function devToolsAreAllowed() {
  // Packaged DevTools are opt-in so a support build can still enable them without
  // leaving every production install with a privileged debugging surface open.
  return isDev || process.env.ASCENDARA_ENABLE_DEVTOOLS === "1";
}

/**
 * Create the main application window
 * @returns {BrowserWindow} - The created window
 */
function createWindow() {
  // Detect if Big Picture mode should be used
  const startInBigPicture = process.argv.some(
    arg => arg.toLowerCase() === "--big-picture"
  );
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // If screen height is less than 900px, likely a laptop
  const isLaptop = screenHeight < 900;

  const windowWidth = isLaptop ? Math.min(1500, screenWidth * 0.9) : 1600;
  const windowHeight = isLaptop ? Math.min(700, screenHeight * 0.9) : 800;
  const allowLegacyNodeIntegration =
    process.env.ASCENDARA_LEGACY_NODE_INTEGRATION === "1";

  if (allowLegacyNodeIntegration) {
    // This switch is only here as a recovery path while older installations are being
    // exercised against the isolated renderer. It should never become a normal launch flag.
    console.warn(
      "Legacy renderer Node integration is enabled through ASCENDARA_LEGACY_NODE_INTEGRATION=1."
    );
  }

  const iconFile = process.platform === "linux" ? "icon.png" : "icon.ico";
  const mainWindow = new BrowserWindow({
    title: "Ascendara",
    icon: path.join(__dirname, "..", iconFile),
    width: windowWidth,
    height: windowHeight,
    frame: false,
    show: false,
    backgroundColor: "#09090b",
    // Enable native full-screen if asked for
    fullscreen: startInBigPicture,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      // Page code should only reach privileged functionality through the named preload
      // APIs. Keeping Node out of the renderer turns an XSS bug into a UI bug instead of
      // automatically giving it filesystem/process access.
      nodeIntegration: allowLegacyNodeIntegration,
      contextIsolation: true,
      // Linux packaging currently relies on the existing unsandboxed path. Keeping
      // it here avoids a silent platform regression while the IPC layer is tightened.
      sandbox: false,
      // A few renderer services still call remote APIs directly. We keep this for
      // compatibility until those calls are moved behind the local proxy/main process.
      webSecurity: false,
      devTools: devToolsAreAllowed(),
      // These are explicit even though Electron defaults are already conservative.
      // It makes the security assumptions visible next to the legacy flags above.
      webviewTag: false,
      navigateOnDragDrop: false,
      allowRunningInsecureContent: false,
      safeDialogs: true,
      // Prevent rendering stalls when the window is idle or in the background
      backgroundThrottling: false,
    },
  });

  // Browser permissions are only useful to the local renderer. Remote OAuth pages
  // should never inherit clipboard/media access just because they were opened by us.
  const allowedRendererPermissions = new Set([
    "notifications",
    "clipboard-read",
    "clipboard-sanitized-write",
  ]);
  const isAllowedPermission = (webContents, permission, requestingOrigin) => {
    const sourceUrl = requestingOrigin || webContents?.getURL() || "";
    return isAllowedAppNavigation(sourceUrl) && allowedRendererPermissions.has(permission);
  };

  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      isAllowedPermission(webContents, permission, requestingOrigin)
  );
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(isAllowedPermission(webContents, permission, details?.requestingUrl));
    }
  );

  // Width, Height
  mainWindow.setMinimumSize(600, 400);

  // Only show the window when it's ready to be displayed
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindowHidden = false;
  });

  // Adding hash to URL
  const urlSuffix = startInBigPicture ? "#/bigpicture" : "";

  if (isDev) {
    // Load from localhost:5173 in development
    mainWindow.loadURL("http://localhost:5173" + urlSuffix);
  } else {
    mainWindow.loadURL("http://localhost:46859" + urlSuffix);
  }

  // Handle load failures (e.g., local server not running)
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error(`Failed to load: ${errorCode} - ${errorDescription}`);
    const safeErrorDescription = escapeHtml(errorDescription);
    const safeErrorCode = escapeHtml(errorCode);

    // Show a helpful error page instead of white screen. The error text is escaped
    // because this fallback is assembled as HTML rather than rendered by React.
    mainWindow.loadURL(`data:text/html,
      <html>
        <head>
          <style>
            body { background: #09090b; color: #fff; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; flex-direction: column; }
            h1 { color: #ef4444; margin-bottom: 16px; }
            p { color: #a1a1aa; max-width: 500px; text-align: center; line-height: 1.6; }
            code { background: #27272a; padding: 2px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Failed to Load Ascendara</h1>
          <p>Error: ${safeErrorDescription} (${safeErrorCode})</p>
          <p>This may be caused by:</p>
          <p>• Missing Visual C++ Redistributables - <a href="https://aka.ms/vs/17/release/vc_redist.x64.exe" style="color: #3b82f6;">Download here</a></p>
          <p>• Antivirus blocking the app</p>
          <p>• Port 46859 being used by another application</p>
          <p>Try restarting Ascendara or your computer.</p>
        </body>
      </html>
    `);
  });

  const handleUnexpectedNavigation = (event, url) => {
    if (isAllowedAppNavigation(url)) return;

    event.preventDefault();

    // Normal web links belong in the user's browser. Everything else is simply
    // blocked so file:, javascript:, and custom schemes cannot replace the app UI.
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(error => {
        console.error("Failed to open external URL:", error);
      });
    } else {
      console.warn("Blocked unsafe navigation attempt:", url);
    }
  };

  mainWindow.webContents.on("will-navigate", handleUnexpectedNavigation);
  mainWindow.webContents.on("will-redirect", handleUnexpectedNavigation);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAuthUrl(url)) {
      // OAuth needs a real child window, but it does not need access to Node or the
      // Ascendara preload bridge. Keeping it isolated limits what remote content can do.
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            devTools: isDev,
          },
        },
      };
    }

    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(error => {
        console.error("Failed to open external URL:", error);
      });
    } else {
      console.warn("Blocked unsafe window open attempt:", url);
    }

    return { action: "deny" };
  });

  // Add window event listeners
  mainWindow.on("hide", () => {
    mainWindowHidden = true;
    console.log("Window hidden event fired");
    // Notify renderer to set status to invisible when hiding to tray
    mainWindow.webContents.send("app-hidden");
  });

  mainWindow.on("show", () => {
    mainWindowHidden = false;
    console.log("Window shown event fired");
    // Notify renderer to restore status when showing from tray
    mainWindow.webContents.send("app-shown");
  });

  mainWindow.on("close", () => {
    console.log("Window close event fired");
  });

  // Recover from GPU/renderer process crashes that cause a black screen
  mainWindow.webContents.on("render-process-gone", (event, details) => {
    console.error(`Renderer process gone: ${details.reason} (exitCode: ${details.exitCode})`);
    if (details.reason === "clean-exit") return;
    // Defer reload so Chromium can finish crash cleanup first (prevents observer assertion)
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        console.log("Reloading window to recover from renderer crash...");
        mainWindow.reload();
      }
    }, 500);
  });

  return mainWindow;
}

/**
 * Hide the main window
 */
function hideWindow() {
  // Don't hide window if handling protocol URL
  if (isHandlingProtocolUrl) {
    console.log("Skipping window hide during protocol URL handling");
    return;
  }

  const mainWindow = BrowserWindow.getAllWindows().find(win => win);
  if (mainWindow) {
    mainWindowHidden = true;
    mainWindow.hide();
    console.log("Window hidden");
  }
}

/**
 * Show the main window
 */
function showWindow() {
  const mainWindow = BrowserWindow.getAllWindows().find(win => win);
  if (mainWindow) {
    mainWindowHidden = false;
    mainWindow.show();

    // Restore if minimized
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    // Add setAlwaysOnTop temporarily to force focus
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    // Remove the always on top flag after focusing
    setTimeout(() => {
      mainWindow.setAlwaysOnTop(false);
    }, 100);
  } else {
    console.log("Creating new window from showWindow function");
    createWindow();
    initializeDiscordRPC();
  }
}

/**
 * Set the protocol URL handling flag
 * @param {boolean} value - Whether currently handling protocol URL
 */
function setHandlingProtocolUrl(value) {
  isHandlingProtocolUrl = value;
}

/**
 * Check if main window is hidden
 * @returns {boolean}
 */
function isMainWindowHidden() {
  return mainWindowHidden;
}

/**
 * Set main window hidden state
 * @param {boolean} value
 */
function setMainWindowHidden(value) {
  mainWindowHidden = value;
}

/**
 * Get the main window
 * @returns {BrowserWindow|null} - The main window or null if not found
 */
function getMainWindow() {
  return BrowserWindow.getAllWindows().find(win => win) || null;
}

/**
 * Show an error dialog
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 */
async function showErrorDialog(title, message) {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: title,
      message: message,
      buttons: ["OK"],
    });
  }
}

/**
 * Register window-related IPC handlers
 */
function registerWindowHandlers() {
  ipcMain.handle("open-devtools", () => {
    if (!devToolsAreAllowed()) {
      console.warn(
        "DevTools are disabled in packaged builds. Set ASCENDARA_ENABLE_DEVTOOLS=1 for support debugging."
      );
      return false;
    }

    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      }
      return true;
    }
    return false;
  });

  // Minimize the window
  ipcMain.handle("minimize-window", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
  });

  // Maximize the window
  ipcMain.handle("maximize-window", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
        return false;
      } else {
        win.maximize();
        return true;
      }
    }
    return false;
  });

  // Let the interface knows if it's already at max at start
  ipcMain.handle("is-window-maximized", () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? win.isMaximized() : false;
  });

  // Handle fullscreen toggle
  ipcMain.handle("toggle-fullscreen", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.setFullScreen(!win.isFullScreen());
      return win.isFullScreen();
    }
    return false;
  });

  ipcMain.handle("get-fullscreen-state", () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? win.isFullScreen() : false;
  });

  // Close the window
  ipcMain.handle("close-window", async (_, forceQuit = false) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      const settingsManager = getSettingsManager();
      const settings = settingsManager.getSettings();

      if (forceQuit === true || settings.endOnClose) {
        // Set quitting flag to allow app to quit
        app.isQuitting = true;
        console.log("Closing app completely...");

        // Destroy all windows to ensure cleanup
        BrowserWindow.getAllWindows().forEach(window => {
          if (!window.isDestroyed()) {
            window.destroy();
          }
        });

        // Force quit the app
        app.quit();
      } else {
        // Default behavior
        mainWindowHidden = true;
        destroyDiscordRPC();
        win.hide();
        console.log("Window hidden to tray");
      }
    }
  });

  // Clear cache
  ipcMain.handle("clear-cache", async () => {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        // Clear all browser data including cache, cookies, storage etc.
        await mainWindow.webContents.session.clearStorageData({
          storages: [
            "appcache",
            "cookies",
            "filesystem",
            "indexdb",
            "localstorage",
            "shadercache",
            "websql",
            "serviceworkers",
            "cachestorage",
          ],
        });

        // Clear HTTP cache specifically
        await mainWindow.webContents.session.clearCache();

        return true;
      }
      return false;
    } catch (error) {
      console.error("Error clearing cache:", error);
      return false;
    }
  });

  // Get asset path
  ipcMain.handle("get-asset-path", (_, filename) => {
    const fs = require("fs-extra");
    const publicDirectory = !app.isPackaged
      ? path.join(__dirname, "../../src/public")
      : path.join(process.resourcesPath, "public");
    const assetPath = resolveInsideDirectory(publicDirectory, filename);

    // The renderer only needs public assets here. Rejecting traversal also keeps a
    // compromised UI from turning this convenience handler into a general file reader.
    if (!assetPath) {
      console.warn("Blocked asset path outside the public directory:", filename);
      return null;
    }

    if (!fs.existsSync(assetPath)) {
      console.error(`Asset not found: ${assetPath}`);
      return null;
    }

    // Return the raw file data as base64
    const imageBuffer = fs.readFileSync(assetPath);
    return `data:image/png;base64,${imageBuffer.toString("base64")}`;
  });

  // Get audio asset as base64 data URL
  ipcMain.handle("get-audio-asset", (_, filename) => {
    const fs = require("fs-extra");
    const publicDirectory = !app.isPackaged
      ? path.join(__dirname, "../../src/public")
      : path.join(process.resourcesPath, "public");
    const assetPath = resolveInsideDirectory(publicDirectory, filename);

    if (!assetPath) {
      console.warn("Blocked audio path outside the public directory:", filename);
      return null;
    }

    if (!fs.existsSync(assetPath)) {
      console.error(`Audio asset not found: ${assetPath}`);
      return null;
    }

    const audioBuffer = fs.readFileSync(assetPath);
    return `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
  });
}

module.exports = {
  createWindow,
  hideWindow,
  showWindow,
  getMainWindow,
  setHandlingProtocolUrl,
  isMainWindowHidden,
  setMainWindowHidden,
  showErrorDialog,
  registerWindowHandlers,
};
