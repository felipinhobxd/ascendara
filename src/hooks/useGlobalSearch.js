import { useEffect } from "react";
import { useSearch } from "@/context/SearchContext";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  createSettingsRecoveryPoint,
  listOfficialRollbackVersions,
  restoreLatestSettingsRecoveryPoint,
  rollbackAscendaraVersion,
} from "@/services/recoveryService";

const SYSTEM_CENTER_EVENT = "ascendara:open-system-center";
const GAME_PROFILES_EVENT = "ascendara:open-game-profiles";
const SMART_COLLECTIONS_EVENT = "ascendara:open-smart-collections";

const openSystemCenter = tab => {
  window.dispatchEvent(
    new CustomEvent(SYSTEM_CENTER_EVENT, {
      detail: { tab },
    })
  );
};

export const useGlobalSearch = () => {
  const { openSearch, registerSearchable, unregisterSearchable } = useSearch();
  const location = useLocation();

  useEffect(() => {
    // The official updater emits update-ready before the user can install the new build.
    // Capturing settings here gives Recovery a stable point without changing the updater's
    // download/install flow or trying to maintain our own copy of the application binary.
    const handleUpdateReady = async () => {
      try {
        const point = await createSettingsRecoveryPoint("before-update");
        console.log("[Recovery] Created pre-update settings point:", point?.id);
      } catch (error) {
        console.warn("[Recovery] Could not create pre-update settings point:", error);
      }
    };

    const unsubscribe = window.electron?.onUpdateReady?.(handleUpdateReady);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
      else window.electron?.removeUpdateReadyListener?.(handleUpdateReady);
    };
  }, []);

  useEffect(() => {
    // Commands live in the same search registry as games and settings, but stay in their
    // own category so Ctrl+K can grow into a command palette without changing existing
    // library/settings search behavior.
    registerSearchable("commands", [
      {
        id: "system-center",
        type: "commands",
        label: "Open System Center",
        description: "Health checks, storage and recovery tools",
        badge: "System",
        onSelect: () => openSystemCenter("health"),
      },
      {
        id: "health-center",
        type: "commands",
        label: "Run health check",
        description: "Check folders, services, dependencies and optional tools",
        badge: "Health",
        onSelect: () => openSystemCenter("health"),
      },
      {
        id: "storage-manager",
        type: "commands",
        label: "Open Storage Manager",
        description: "Inspect game usage and free space across configured locations",
        badge: "Storage",
        onSelect: () => openSystemCenter("storage"),
      },
      {
        id: "recovery-center",
        type: "commands",
        label: "Open Recovery tools",
        description: "Safe UI Mode, recovery points, cache recovery and diagnostics",
        badge: "Recovery",
        onSelect: () => openSystemCenter("recovery"),
      },
      {
        id: "create-recovery-point",
        type: "commands",
        label: "Create Settings Recovery Point",
        description: "Save the current Ascendara settings outside Chromium browser storage",
        badge: "Recovery",
        onSelect: () => {
          createSettingsRecoveryPoint("manual")
            .then(() => toast.success("Settings recovery point created"))
            .catch(error =>
              toast.error("Could not create recovery point", { description: error.message })
            );
        },
      },
      {
        id: "restore-recovery-point",
        type: "commands",
        label: "Restore Latest Settings Recovery Point",
        description: "Restore the newest saved settings snapshot and reload Ascendara",
        badge: "Recovery",
        onSelect: () => {
          const confirmed = window.confirm(
            "Restore the latest Ascendara settings recovery point? Your current settings will be replaced and the interface will reload."
          );
          if (!confirmed) return;

          restoreLatestSettingsRecoveryPoint()
            .then(() => window.location.reload())
            .catch(error =>
              toast.error("Could not restore recovery point", { description: error.message })
            );
        },
      },
      {
        id: "rollback-previous-version",
        type: "commands",
        label: "Rollback to Previous Ascendara Version",
        description: "Windows live branch only · uses an older official GitHub release",
        badge: "Recovery",
        onSelect: async () => {
          const toastId = toast.loading("Checking official rollback versions…");
          try {
            const releases = await listOfficialRollbackVersions();
            toast.dismiss(toastId);
            if (releases.length === 0) {
              toast.info("No supported previous version is available", {
                description: "Binary rollback is available only on Windows live builds with an older official release.",
              });
              return;
            }

            const previous = releases[0];
            const confirmed = window.confirm(
              `Rollback Ascendara to ${previous.version}? A settings recovery point will be created first, then the official installer will be downloaded and Ascendara will close.`
            );
            if (!confirmed) return;

            toast.loading(`Downloading Ascendara ${previous.version}…`, {
              id: "ascendara-rollback",
            });
            await rollbackAscendaraVersion(previous.version);
          } catch (error) {
            toast.dismiss(toastId);
            toast.error("Rollback could not start", {
              id: "ascendara-rollback",
              description: error.message,
            });
          }
        },
      },
      {
        id: "game-profiles",
        type: "commands",
        label: "Manage Game Profiles",
        description: "Launch commands, backups, UMU and custom save paths per game",
        badge: "Games",
        onSelect: () => window.dispatchEvent(new CustomEvent(GAME_PROFILES_EVENT)),
      },
      {
        id: "smart-collections",
        type: "commands",
        label: "Open Smart Collections",
        description: "Continue Playing, Never Played, Custom, Online, VR and DLC groups",
        badge: "Library",
        onSelect: () => window.dispatchEvent(new CustomEvent(SMART_COLLECTIONS_EVENT)),
      },
      {
        id: "big-picture",
        type: "commands",
        label: "Enter Big Picture Mode",
        description: "Open Ascendara's controller-first interface",
        badge: "Navigate",
        onSelect: navigate => navigate("/bigpicture"),
      },
      {
        id: "local-refresh",
        type: "commands",
        label: "Refresh Local Index",
        description: "Open the official Local Index refresh flow",
        badge: "Index",
        onSelect: navigate => navigate("/localrefresh"),
      },
      {
        id: "open-settings",
        type: "commands",
        label: "Open Settings",
        description: "Go directly to Ascendara settings",
        badge: "Navigate",
        onSelect: navigate => navigate("/settings"),
      },
      {
        id: "reload-interface",
        type: "commands",
        label: "Reload interface",
        description: "Reload the renderer without changing your library or settings",
        badge: "Recovery",
        onSelect: () => window.location.reload(),
      },
    ]);

    return () => unregisterSearchable("commands");
  }, [registerSearchable, unregisterSearchable]);

  useEffect(() => {
    const handleKeyDown = e => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const isCtrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      if (isCtrlOrCmd && e.key === "f") {
        const target = e.target;
        const isInInput =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;

        if (!isInInput) {
          e.preventDefault();

          const pathname = location.pathname;
          if (pathname === "/library") {
            openSearch("library");
          } else if (pathname === "/settings") {
            openSearch("settings");
          } else {
            openSearch("global");
          }
        }
      }

      if (isCtrlOrCmd && e.key === "k") {
        e.preventDefault();
        openSearch("global");
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSearch, location.pathname]);
};
