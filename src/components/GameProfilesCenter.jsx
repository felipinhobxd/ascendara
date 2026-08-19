import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2, RefreshCw, Save, ShieldCheck, FolderOpen, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import GamesBackupDialog from "@/components/GamesBackupDialog";

const GAME_PROFILES_EVENT = "ascendara:open-game-profiles";

function getGameName(game) {
  return game?.game || game?.name || "";
}

function normalizeGame(game, isCustom) {
  return {
    ...game,
    isCustom: Boolean(isCustom || game?.isCustom || game?.custom),
  };
}

const GameProfilesCenter = () => {
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loadingGames, setLoadingGames] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [isLinux, setIsLinux] = useState(false);
  const [profile, setProfile] = useState({
    launchCommands: "",
    autoBackup: false,
    umuId: "",
    savePaths: [],
  });

  useEffect(() => {
    const handleOpen = event => {
      setOpen(true);
      const requestedGame = event?.detail?.game;
      if (requestedGame) setSelectedKey(String(requestedGame));
    };

    window.addEventListener(GAME_PROFILES_EVENT, handleOpen);
    return () => window.removeEventListener(GAME_PROFILES_EVENT, handleOpen);
  }, []);

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    try {
      const [installed, custom, linux] = await Promise.all([
        window.electron.getGames(),
        window.electron.getCustomGames(),
        window.electron.isOnLinux(),
      ]);

      const merged = [
        ...(Array.isArray(installed) ? installed.map(game => normalizeGame(game, false)) : []),
        ...(Array.isArray(custom) ? custom.map(game => normalizeGame(game, true)) : []),
      ];

      const seen = new Set();
      const unique = merged.filter(game => {
        const key = `${game.isCustom ? "custom" : "installed"}:${getGameName(game)}`;
        if (!getGameName(game) || seen.has(key)) return false;
        seen.add(key);
        game.__profileKey = key;
        return true;
      });

      unique.sort((a, b) => getGameName(a).localeCompare(getGameName(b)));
      setGames(unique);
      setIsLinux(Boolean(linux));
      if (!selectedKey && unique.length > 0) setSelectedKey(unique[0].__profileKey);
    } catch (error) {
      console.error("[GameProfiles] Failed to load games:", error);
      toast.error("Could not load installed games", { description: error.message });
    } finally {
      setLoadingGames(false);
    }
  }, [selectedKey]);

  useEffect(() => {
    if (open) loadGames();
  }, [open, loadGames]);

  const selectedGame = useMemo(
    () => games.find(game => game.__profileKey === selectedKey) || null,
    [games, selectedKey]
  );

  const loadProfile = useCallback(async game => {
    if (!game) return;
    setLoadingProfile(true);
    const gameName = getGameName(game);

    try {
      const [launchCommands, autoBackup, savePathsResult, umuId] = await Promise.all([
        window.electron.getLaunchCommands(gameName, game.isCustom).catch(() => ""),
        window.electron.isGameAutoBackupsEnabled(gameName, game.isCustom).catch(() => false),
        window.electron.getCustomSavePaths(gameName, game.isCustom).catch(() => ({
          success: false,
          paths: [],
        })),
        isLinux ? window.electron.umuGetGameId(gameName).catch(() => "") : Promise.resolve(""),
      ]);

      setProfile({
        launchCommands:
          typeof launchCommands === "string"
            ? launchCommands
            : launchCommands?.launchCommands || launchCommands?.value || "",
        autoBackup: Boolean(autoBackup),
        umuId:
          typeof umuId === "string" || typeof umuId === "number"
            ? String(umuId || "")
            : String(umuId?.id || umuId?.umuId || ""),
        savePaths: savePathsResult?.success ? savePathsResult.paths || [] : [],
      });
    } catch (error) {
      console.error("[GameProfiles] Failed to load profile:", error);
      toast.error("Could not load game profile", { description: error.message });
    } finally {
      setLoadingProfile(false);
    }
  }, [isLinux]);

  useEffect(() => {
    if (open && selectedGame) loadProfile(selectedGame);
  }, [open, selectedGame, loadProfile]);

  const saveProfile = async () => {
    if (!selectedGame) return;
    const gameName = getGameName(selectedGame);
    setSaving(true);

    try {
      await window.electron.saveLaunchCommands(
        gameName,
        profile.launchCommands,
        selectedGame.isCustom
      );

      if (profile.autoBackup) {
        await window.electron.enableGameAutoBackups(gameName, selectedGame.isCustom);
      } else {
        await window.electron.disableGameAutoBackups(gameName, selectedGame.isCustom);
      }

      const savePaths = profile.savePaths.map(path => path.trim()).filter(Boolean);
      const savePathsResult = await window.electron.setCustomSavePaths(
        gameName,
        selectedGame.isCustom,
        savePaths
      );
      if (savePathsResult && savePathsResult.success === false) {
        throw new Error(savePathsResult.error || "Could not save custom save paths");
      }

      if (isLinux && profile.umuId.trim()) {
        await window.electron.umuSetGameId(gameName, profile.umuId.trim());
      }

      toast.success("Game profile saved", {
        description: `${gameName} will use these settings the next time it launches.`,
      });
    } catch (error) {
      console.error("[GameProfiles] Failed to save profile:", error);
      toast.error("Could not save game profile", { description: error.message });
    } finally {
      setSaving(false);
    }
  };

  const browseSavePath = async index => {
    try {
      const result = await window.electron.openFolderDialog();
      if (!result?.path) return;
      setProfile(current => ({
        ...current,
        savePaths: current.savePaths.map((path, itemIndex) =>
          itemIndex === index ? result.path : path
        ),
      }));
    } catch (error) {
      toast.error("Could not open folder picker", { description: error.message });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[86vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Gamepad2 className="h-6 w-6 text-primary" /> Game Profiles
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <select
                value={selectedKey}
                onChange={event => setSelectedKey(event.target.value)}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                {games.map(game => (
                  <option key={game.__profileKey} value={game.__profileKey}>
                    {getGameName(game)}{game.isCustom ? " (Custom)" : ""}
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={loadGames} disabled={loadingGames}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loadingGames ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {!selectedGame ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No installed games were found.
              </div>
            ) : loadingProfile ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                Loading profile…
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-card p-5">
                  <Label htmlFor="profile-launch-commands" className="font-medium">
                    Launch commands
                  </Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Uses Ascendara's existing per-game launch command field.
                  </p>
                  <Input
                    id="profile-launch-commands"
                    className="mt-3 font-mono"
                    value={profile.launchCommands}
                    onChange={event =>
                      setProfile(current => ({ ...current, launchCommands: event.target.value }))
                    }
                    placeholder="Leave empty to use the game's default launch behavior"
                  />
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <h3 className="font-medium text-foreground">Automatic save backups</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Uses the same Ludusavi auto-backup setting already supported by Ascendara.
                      </p>
                    </div>
                    <Switch
                      checked={profile.autoBackup}
                      onCheckedChange={value =>
                        setProfile(current => ({ ...current, autoBackup: Boolean(value) }))
                      }
                    />
                  </div>
                </div>

                {isLinux && (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <Label htmlFor="profile-umu-id" className="font-medium">
                      UMU game ID
                    </Label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Overrides the game-specific UMU mapping without changing global Proton settings.
                    </p>
                    <Input
                      id="profile-umu-id"
                      className="mt-3 font-mono"
                      value={profile.umuId}
                      onChange={event =>
                        setProfile(current => ({ ...current, umuId: event.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </div>
                )}

                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-foreground">Custom save paths</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        These paths are passed to Ascendara's existing backup integration.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setProfile(current => ({
                          ...current,
                          savePaths: [...current.savePaths, ""],
                        }))
                      }
                    >
                      Add path
                    </Button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {profile.savePaths.map((path, index) => (
                      <div key={`${index}-${path}`} className="flex gap-2">
                        <Input
                          className="font-mono text-xs"
                          value={path}
                          onChange={event =>
                            setProfile(current => ({
                              ...current,
                              savePaths: current.savePaths.map((value, itemIndex) =>
                                itemIndex === index ? event.target.value : value
                              ),
                            }))
                          }
                          placeholder="Save directory"
                        />
                        <Button size="icon" variant="outline" onClick={() => browseSavePath(index)}>
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setProfile(current => ({
                              ...current,
                              savePaths: current.savePaths.filter((_, itemIndex) => itemIndex !== index),
                            }))
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    {profile.savePaths.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No custom save paths. Ludusavi will use its normal detection.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Profile settings reuse Ascendara's official per-game APIs.
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setBackupOpen(true)}>
                      <History className="mr-2 h-4 w-4" /> Backup Timeline
                    </Button>
                    <Button onClick={saveProfile} disabled={saving}>
                      <Save className="mr-2 h-4 w-4" />
                      {saving ? "Saving…" : "Save profile"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {selectedGame && (
        <GamesBackupDialog
          game={selectedGame}
          open={backupOpen}
          onOpenChange={setBackupOpen}
        />
      )}
    </>
  );
};

export { GAME_PROFILES_EVENT };
export default GameProfilesCenter;
