import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Database,
  FolderCog,
  Gauge,
  HardDrive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { checkServerStatus } from "@/services/serverStatus";
import {
  clearTransientUiState,
  initializeRecoveryMode,
  isSafeUiModeEnabled,
  setSafeUiMode,
} from "@/services/recoveryService";

const SYSTEM_CENTER_EVENT = "ascendara:open-system-center";
const LOW_SPACE_BYTES = 5 * 1024 * 1024 * 1024;

const STATUS_META = {
  healthy: {
    icon: CheckCircle2,
    label: "Healthy",
    className: "text-green-500",
    badge: "border-green-500/30 bg-green-500/10 text-green-500",
  },
  warning: {
    icon: AlertTriangle,
    label: "Attention",
    className: "text-yellow-500",
    badge: "border-yellow-500/30 bg-yellow-500/10 text-yellow-500",
  },
  error: {
    icon: XCircle,
    label: "Problem",
    className: "text-red-500",
    badge: "border-red-500/30 bg-red-500/10 text-red-500",
  },
  info: {
    icon: CircleHelp,
    label: "Info",
    className: "text-blue-500",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-500",
  },
};

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
}

function normalizeToolStatus(value) {
  if (value === true) return true;
  if (value && typeof value === "object") {
    return value.installed === true || value.success === true || value.status === "installed";
  }
  return false;
}

function HealthRow({ item, onAction }) {
  const meta = STATUS_META[item.status] || STATUS_META.info;
  const Icon = meta.icon;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-4">
      <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${meta.className}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{item.title}</p>
          <Badge variant="outline" className={meta.badge}>
            {meta.label}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
        {item.detail && (
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground/80">
            {item.detail}
          </p>
        )}
      </div>
      {item.action && (
        <Button size="sm" variant="outline" onClick={() => onAction(item.action)}>
          {item.action.label}
        </Button>
      )}
    </div>
  );
}

const SystemCenter = () => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("health");
  const [checking, setChecking] = useState(false);
  const [healthItems, setHealthItems] = useState([]);
  const [storage, setStorage] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [safeUiMode, setSafeUiModeState] = useState(false);

  useEffect(() => {
    initializeRecoveryMode();
    setSafeUiModeState(isSafeUiModeEnabled());

    const handleOpen = event => {
      const requestedTab = event?.detail?.tab;
      if (["health", "storage", "recovery"].includes(requestedTab)) {
        setActiveTab(requestedTab);
      }
      setOpen(true);
    };

    window.addEventListener(SYSTEM_CENTER_EVENT, handleOpen);
    return () => window.removeEventListener(SYSTEM_CENTER_EVENT, handleOpen);
  }, []);

  const openSettings = useCallback(() => {
    setOpen(false);
    window.location.hash = "#/settings";
  }, []);

  const openLocalRefresh = useCallback(() => {
    setOpen(false);
    window.location.hash = "#/localrefresh";
  }, []);

  const refreshStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      const downloadDirectory = await window.electron.getDownloadDirectory();
      const [driveSpace, gamesSize] = await Promise.all([
        window.electron.getDriveSpace(downloadDirectory),
        window.electron.getInstalledGamesSize(),
      ]);
      setStorage({ downloadDirectory, driveSpace, gamesSize });
    } catch (error) {
      console.error("[SystemCenter] Storage check failed:", error);
      toast.error("Could not inspect storage", { description: error.message });
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const runHealthCheck = useCallback(async () => {
    setChecking(true);
    const items = [];

    try {
      const [settings, isWindows, isLinux, serverStatus] = await Promise.all([
        window.electron.getSettings(),
        window.electron.isOnWindows(),
        window.electron.isOnLinux(),
        checkServerStatus(true),
      ]);

      items.push({
        id: "settings",
        status: settings ? "healthy" : "error",
        title: "Settings",
        description: settings
          ? "Ascendara can read its current configuration."
          : "Ascendara could not read its configuration.",
        action: settings ? null : { type: "settings", label: "Open Settings" },
      });

      const downloadDirectory = settings?.downloadDirectory || (await window.electron.getDownloadDirectory());
      if (!downloadDirectory) {
        items.push({
          id: "download-directory",
          status: "error",
          title: "Game directory",
          description: "No primary game directory is configured.",
          action: { type: "settings", label: "Configure" },
        });
      } else {
        const [writable, driveSpace] = await Promise.all([
          window.electron.canCreateFiles(downloadDirectory),
          window.electron.getDriveSpace(downloadDirectory),
        ]);
        const freeSpace = Number(driveSpace?.freeSpace) || 0;
        items.push({
          id: "download-directory",
          status: !writable ? "error" : freeSpace > 0 && freeSpace < LOW_SPACE_BYTES ? "warning" : "healthy",
          title: "Game directory",
          description: !writable
            ? "Ascendara cannot create files in the configured game directory."
            : freeSpace > 0 && freeSpace < LOW_SPACE_BYTES
              ? `The directory is writable, but only ${formatBytes(freeSpace)} is free.`
              : `The directory is writable${freeSpace > 0 ? ` with ${formatBytes(freeSpace)} free` : ""}.`,
          detail: downloadDirectory,
          action: !writable ? { type: "settings", label: "Review" } : null,
        });
      }

      if (settings?.customSourcesMode) {
        items.push({
          id: "index",
          status: settings?.customSource?.url ? "healthy" : "warning",
          title: "External Source",
          description: settings?.customSource?.url
            ? "External Sources mode is configured."
            : "External Sources mode is enabled without an active source.",
          detail: settings?.customSource?.url || null,
          action: settings?.customSource?.url ? null : { type: "settings", label: "Configure" },
        });
      } else if (settings?.localIndex) {
        const localIndexExists = await window.electron.checkFileExists(settings.localIndex);
        items.push({
          id: "index",
          status: localIndexExists ? "healthy" : "warning",
          title: "Local Index",
          description: localIndexExists
            ? "The configured Local Index is available."
            : "The configured Local Index could not be found at its saved path.",
          detail: settings.localIndex,
          action: localIndexExists ? null : { type: "local-refresh", label: "Repair" },
        });
      } else {
        items.push({
          id: "index",
          status: "warning",
          title: "Game Index",
          description: "No Local Index is configured and External Sources mode is not active.",
          action: { type: "local-refresh", label: "Set Up" },
        });
      }

      const serviceNames = ["monitor", "api", "storage", "lfs", "r2"];
      const failedServices = serviceNames.filter(name => !serverStatus?.[name]?.ok);
      items.push({
        id: "services",
        status: serverStatus?.noInternet || failedServices.length > 0 ? "warning" : "healthy",
        title: "Ascendara services",
        description: serverStatus?.noInternet
          ? "No connection to Ascendara services was detected."
          : failedServices.length > 0
            ? `Unavailable: ${failedServices.join(", ")}. Other local features can continue to work.`
            : "Monitor, API, CDN, LFS and R2 endpoints are reachable.",
      });

      try {
        const tools = await window.electron.getInstalledTools();
        const count = Array.isArray(tools) ? tools.length : 0;
        items.push({
          id: "tools",
          status: "info",
          title: "Optional tools",
          description: `${count} optional Ascendara tool${count === 1 ? " is" : "s are"} currently registered as installed.`,
        });
      } catch {
        items.push({
          id: "tools",
          status: "warning",
          title: "Optional tools",
          description: "Ascendara could not inspect optional tools.",
        });
      }

      if (isWindows) {
        try {
          const dependencies = await window.electron.checkGameDependencies();
          const missing = Array.isArray(dependencies)
            ? dependencies.filter(dependency => dependency.installed === false)
            : [];
          items.push({
            id: "dependencies",
            status: missing.length > 0 ? "warning" : "healthy",
            title: "Windows game dependencies",
            description: missing.length > 0
              ? `${missing.length} dependency${missing.length === 1 ? " is" : "ies are"} missing: ${missing.map(item => item.name || item.file).join(", ")}.`
              : "Required game dependencies were detected.",
            action: missing.length > 0 ? { type: "install-dependencies", label: "Install" } : null,
          });
        } catch (error) {
          items.push({
            id: "dependencies",
            status: "warning",
            title: "Windows game dependencies",
            description: `Dependency status could not be checked: ${error.message}`,
          });
        }
      }

      if (isLinux) {
        try {
          const umu = await window.electron.isUmuInstalled();
          items.push({
            id: "umu",
            status: normalizeToolStatus(umu) ? "healthy" : "info",
            title: "UMU Launcher",
            description: normalizeToolStatus(umu)
              ? "UMU Launcher is available for Linux game compatibility."
              : "UMU Launcher is not installed. This is optional and can be configured from Settings.",
            action: normalizeToolStatus(umu) ? null : { type: "settings", label: "Configure" },
          });
        } catch {}
      }

      try {
        const steamCmd = await window.electron.isSteamCMDInstalled();
        items.push({
          id: "steamcmd",
          status: normalizeToolStatus(steamCmd) ? "healthy" : "info",
          title: "SteamCMD",
          description: normalizeToolStatus(steamCmd)
            ? "SteamCMD is available."
            : "SteamCMD is not installed. Workshop features can install it when needed.",
        });
      } catch {}
    } catch (error) {
      console.error("[SystemCenter] Health check failed:", error);
      items.push({
        id: "health-error",
        status: "error",
        title: "Health check interrupted",
        description: error.message || "An unexpected error interrupted the health check.",
      });
    }

    setHealthItems(items);
    setChecking(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (activeTab === "health") runHealthCheck();
    if (activeTab === "storage") refreshStorage();
  }, [open, activeTab, runHealthCheck, refreshStorage]);

  const handleHealthAction = useCallback(
    async action => {
      if (!action) return;
      if (action.type === "settings") {
        openSettings();
        return;
      }
      if (action.type === "local-refresh") {
        openLocalRefresh();
        return;
      }
      if (action.type === "install-dependencies") {
        try {
          toast.info("Installing game dependencies…");
          await window.electron.installDependencies();
          toast.success("Dependency installer finished");
          runHealthCheck();
        } catch (error) {
          toast.error("Dependency installation failed", { description: error.message });
        }
      }
    },
    [openSettings, openLocalRefresh, runHealthCheck]
  );

  const overallHealth = useMemo(() => {
    if (healthItems.some(item => item.status === "error")) return "error";
    if (healthItems.some(item => item.status === "warning")) return "warning";
    if (healthItems.length > 0) return "healthy";
    return "info";
  }, [healthItems]);

  const healthMeta = STATUS_META[overallHealth];
  const HealthIcon = healthMeta.icon;
  const driveDirectories = storage?.driveSpace?.directories || [];
  const gameDirectories = storage?.gamesSize?.directorySizes || [];

  const handleSafeModeToggle = enabled => {
    setSafeUiMode(enabled);
    setSafeUiModeState(enabled);
    toast.success(enabled ? "Safe UI Mode enabled" : "Safe UI Mode disabled", {
      description: enabled
        ? "Animations and transparency-heavy effects are reduced until you turn it off."
        : "Normal interface effects have been restored.",
    });
  };

  const clearCacheAndReload = async () => {
    try {
      await window.electron.clearCache();
      clearTransientUiState();
      window.location.reload();
    } catch (error) {
      toast.error("Could not clear cache", { description: error.message });
    }
  };

  const tabButton = (id, label, Icon) => (
    <Button
      key={id}
      variant={activeTab === id ? "secondary" : "ghost"}
      className="justify-start gap-2"
      onClick={() => setActiveTab(id)}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[86vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Ascendara System Center
          </DialogTitle>
        </DialogHeader>

        <div className="grid min-h-[560px] grid-cols-[190px_1fr]">
          <aside className="flex flex-col gap-1 border-r border-border bg-muted/20 p-3">
            {tabButton("health", "Health", Activity)}
            {tabButton("storage", "Storage", HardDrive)}
            {tabButton("recovery", "Recovery", Wrench)}
          </aside>

          <section className="overflow-y-auto p-6">
            {activeTab === "health" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <HealthIcon className={`h-6 w-6 ${healthMeta.className}`} />
                      <h2 className="text-xl font-semibold text-foreground">System health</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Checks the existing Ascendara configuration without changing it.
                    </p>
                  </div>
                  <Button variant="outline" onClick={runHealthCheck} disabled={checking}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
                    {checking ? "Checking…" : "Run again"}
                  </Button>
                </div>

                <div className="space-y-3">
                  {healthItems.length === 0 && checking ? (
                    <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                      Checking Ascendara…
                    </div>
                  ) : (
                    healthItems.map(item => (
                      <HealthRow key={item.id} item={item} onAction={handleHealthAction} />
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "storage" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
                      <Gauge className="h-5 w-5 text-primary" /> Storage Manager
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Uses Ascendara's existing directory scanner and drive-space cache.
                    </p>
                  </div>
                  <Button variant="outline" onClick={refreshStorage} disabled={storageLoading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${storageLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Games</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {formatBytes(storage?.gamesSize?.totalSize)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Free space</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {formatBytes(storage?.driveSpace?.freeSpace)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Total capacity</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {formatBytes(storage?.driveSpace?.totalSpace)}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-foreground">Configured locations</h3>
                    <Button size="sm" variant="ghost" onClick={openSettings}>
                      <FolderCog className="mr-2 h-4 w-4" /> Manage folders
                    </Button>
                  </div>
                  {driveDirectories.map(directory => {
                    const gameSize = gameDirectories.find(item => item.path === directory.path)?.size || 0;
                    const usedPercent = directory.totalSpace > 0
                      ? Math.max(0, Math.min(100, ((directory.totalSpace - directory.freeSpace) / directory.totalSpace) * 100))
                      : 0;
                    return (
                      <div key={directory.path} className="rounded-xl border border-border bg-card/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate font-mono text-xs text-foreground">{directory.path}</p>
                          <span className="text-xs text-muted-foreground">{usedPercent.toFixed(0)}% used</span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${usedPercent}%` }} />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <span>Games: {formatBytes(gameSize)}</span>
                          <span>Free: {formatBytes(directory.freeSpace)}</span>
                          <span>Total: {formatBytes(directory.totalSpace)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {!storageLoading && driveDirectories.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                      No storage locations are currently available.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "recovery" && (
              <div className="space-y-5">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
                    <RotateCcw className="h-5 w-5 text-primary" /> Recovery
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Recovery actions are intentionally conservative and do not delete games, sources, backups or account data.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <h3 className="font-medium text-foreground">Safe UI Mode</h3>
                      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        Reduces animations, transitions and transparency-heavy effects. Use this when the interface is stuttering or rendering incorrectly.
                      </p>
                    </div>
                    <Button
                      variant={safeUiMode ? "secondary" : "outline"}
                      onClick={() => handleSafeModeToggle(!safeUiMode)}
                    >
                      {safeUiMode ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-medium text-foreground">Reload interface</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Reloads the renderer without changing your library or settings.
                  </p>
                  <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Reload
                  </Button>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-medium text-foreground">Clear UI cache and temporary state</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Clears Chromium cache and temporary UI-flow flags, then reloads Ascendara. Game data and configured sources are not intentionally removed by this action.
                  </p>
                  <Button className="mt-4" variant="outline" onClick={clearCacheAndReload}>
                    <Database className="mr-2 h-4 w-4" /> Clear cache and reload
                  </Button>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-medium text-foreground">Developer diagnostics</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Opens DevTools using Ascendara's existing Electron command. This is useful for support and development builds.
                  </p>
                  <Button
                    className="mt-4"
                    variant="outline"
                    onClick={async () => {
                      const opened = await window.electron.openDevTools();
                      if (!opened) toast.info("DevTools are unavailable in this build.");
                    }}
                  >
                    <TerminalSquare className="mr-2 h-4 w-4" /> Open DevTools
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { SYSTEM_CENTER_EVENT };
export default SystemCenter;
