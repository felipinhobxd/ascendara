const IPC_CHANNEL_PATTERN = /^[A-Za-z0-9:_-]+$/;
const STRICT_LEGACY_IPC_ENV = "ASCENDARA_STRICT_RENDERER_IPC";

function validateIpcChannel(channel) {
  if (typeof channel !== "string" || !IPC_CHANNEL_PATTERN.test(channel)) {
    throw new TypeError("IPC channel names may only contain letters, numbers, :, _ and -");
  }

  return channel;
}

function legacyBridgeIsStrict() {
  return process.env[STRICT_LEGACY_IPC_ENV] === "1";
}

/**
 * Build the small transport used by preload APIs instead of handing ipcRenderer
 * objects to the page. Keeping listener bookkeeping here also fixes a subtle leak:
 * removing the original callback cannot remove the wrapper that was registered.
 */
function createPreloadIpcTransport(ipcRenderer) {
  if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
    throw new TypeError("A valid ipcRenderer instance is required");
  }

  const listenerRegistry = new Map();
  const warnedLegacyCalls = new Set();

  function rememberListener(channel, callback, listener) {
    let callbacks = listenerRegistry.get(channel);
    if (!callbacks) {
      callbacks = new WeakMap();
      listenerRegistry.set(channel, callbacks);
    }

    let listeners = callbacks.get(callback);
    if (!listeners) {
      listeners = new Set();
      callbacks.set(callback, listeners);
    }

    listeners.add(listener);
  }

  function forgetListener(channel, callback, listener) {
    const callbacks = listenerRegistry.get(channel);
    const listeners = callbacks?.get(callback);
    if (!listeners) return;

    listeners.delete(listener);
    if (listeners.size === 0) callbacks.delete(callback);
  }

  function invoke(channel, ...args) {
    return ipcRenderer.invoke(validateIpcChannel(channel), ...args);
  }

  function subscribe(channel, callback, options = {}) {
    const safeChannel = validateIpcChannel(channel);
    if (typeof callback !== "function") {
      throw new TypeError(`Listener for "${safeChannel}" must be a function`);
    }

    const { includeEventPlaceholder = false, selectArgs = args => args } = options;
    const listener = (_event, ...args) => {
      const selectedArgs = selectArgs(args);
      if (!Array.isArray(selectedArgs)) {
        throw new TypeError(`Argument selector for "${safeChannel}" must return an array`);
      }

      // Some legacy callbacks used (event, data). Passing null keeps their argument
      // positions stable without exposing Electron's privileged event object.
      if (includeEventPlaceholder) {
        callback(null, ...selectedArgs);
      } else {
        callback(...selectedArgs);
      }
    };

    ipcRenderer.on(safeChannel, listener);
    rememberListener(safeChannel, callback, listener);

    return () => {
      ipcRenderer.removeListener(safeChannel, listener);
      forgetListener(safeChannel, callback, listener);
    };
  }

  function unsubscribe(channel, callback) {
    const safeChannel = validateIpcChannel(channel);
    const callbacks = listenerRegistry.get(safeChannel);
    const listeners = callbacks?.get(callback);
    if (!listeners) return;

    for (const listener of listeners) {
      ipcRenderer.removeListener(safeChannel, listener);
    }
    callbacks.delete(callback);
  }

  function removeAllListeners(channel) {
    const safeChannel = validateIpcChannel(channel);
    ipcRenderer.removeAllListeners(safeChannel);
    listenerRegistry.delete(safeChannel);
  }

  function guardLegacyCall(method, channel) {
    const safeChannel = validateIpcChannel(channel);
    const callName = `ipcRenderer.${method}("${safeChannel}")`;

    // Strict mode is used by the developer smoke test. If startup still depends on
    // this compatibility object, CI fails at the exact call instead of letting us
    // discover the dependency after nodeIntegration has already been disabled.
    if (legacyBridgeIsStrict()) {
      throw new Error(
        `${callName} uses Ascendara's legacy renderer IPC bridge. Add or use a named preload API instead.`
      );
    }

    // Keep production compatible during the migration, but leave one useful breadcrumb
    // per call shape for support logs. Once the inventory reaches zero, this object can
    // be removed instead of living as permanent security debt.
    const warningKey = `${method}:${safeChannel}`;
    if (!warnedLegacyCalls.has(warningKey)) {
      warnedLegacyCalls.add(warningKey);
      console.warn(
        `[Preload] ${callName} is deprecated; migrate this caller to a named preload API.`
      );
    }

    return safeChannel;
  }

  const legacy = {
    on: (channel, callback) =>
      subscribe(guardLegacyCall("on", channel), callback, {
        includeEventPlaceholder: true,
      }),
    off: (channel, callback) => unsubscribe(guardLegacyCall("off", channel), callback),
    removeListener: (channel, callback) =>
      unsubscribe(guardLegacyCall("removeListener", channel), callback),
    invoke: (channel, ...args) => invoke(guardLegacyCall("invoke", channel), ...args),
    readFile: (filePath, encoding) => {
      guardLegacyCall("readFile", "read-local-file");
      return invoke("read-local-file", filePath, encoding);
    },
    writeFile: (filePath, content) => {
      guardLegacyCall("writeFile", "write-file");
      return invoke("write-file", filePath, content);
    },
  };

  return {
    invoke,
    legacy,
    removeAllListeners,
    subscribe,
    unsubscribe,
  };
}

module.exports = {
  STRICT_LEGACY_IPC_ENV,
  createPreloadIpcTransport,
  legacyBridgeIsStrict,
  validateIpcChannel,
};
