import { useEffect } from "react";
import { useSearch } from "@/context/SearchContext";
import { useLocation } from "react-router-dom";

const SYSTEM_CENTER_EVENT = "ascendara:open-system-center";
const GAME_PROFILES_EVENT = "ascendara:open-game-profiles";

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
        description: "Safe UI Mode, cache recovery and developer diagnostics",
        badge: "Recovery",
        onSelect: () => openSystemCenter("recovery"),
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
