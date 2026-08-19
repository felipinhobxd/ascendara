export function getGameName(game) {
  return game?.game || game?.name || "";
}

function normalizeGame(game, isCustom) {
  const custom = Boolean(isCustom || game?.isCustom || game?.custom);
  const name = getGameName(game);
  return {
    ...game,
    name: game?.name || name,
    game: game?.game || name,
    isCustom: custom,
    custom,
    __profileKey: `${custom ? "custom" : "installed"}:${name}`,
  };
}

export async function loadGameProfileCatalog() {
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
  const games = merged.filter(game => {
    if (!getGameName(game) || seen.has(game.__profileKey)) return false;
    seen.add(game.__profileKey);
    return true;
  });

  games.sort((a, b) => getGameName(a).localeCompare(getGameName(b)));
  return { games, isLinux: Boolean(linux) };
}

export async function loadGameProfile(game, isLinux) {
  const gameName = getGameName(game);
  if (!gameName) throw new Error("Game name is unavailable");

  const [launchCommands, autoBackup, savePathsResult, umuId] = await Promise.all([
    window.electron.getLaunchCommands(gameName, game.isCustom).catch(() => ""),
    window.electron.isGameAutoBackupsEnabled(gameName, game.isCustom).catch(() => false),
    window.electron.getCustomSavePaths(gameName, game.isCustom).catch(() => ({
      success: false,
      paths: [],
    })),
    isLinux ? window.electron.umuGetGameId(gameName).catch(() => "") : Promise.resolve(""),
  ]);

  return {
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
  };
}

export async function saveGameProfile(game, profile, isLinux) {
  const gameName = getGameName(game);
  if (!gameName) throw new Error("Game name is unavailable");

  const launchResult = await window.electron.saveLaunchCommands(
    gameName,
    profile.launchCommands,
    game.isCustom
  );
  if (launchResult === false) {
    throw new Error("Ascendara could not save launch commands");
  }

  if (profile.autoBackup) {
    await window.electron.enableGameAutoBackups(gameName, game.isCustom);
  } else {
    await window.electron.disableGameAutoBackups(gameName, game.isCustom);
  }

  const savePaths = profile.savePaths.map(value => value.trim()).filter(Boolean);
  const savePathsResult = await window.electron.setCustomSavePaths(
    gameName,
    game.isCustom,
    savePaths
  );
  if (savePathsResult?.success === false) {
    throw new Error(savePathsResult.error || "Ascendara could not save custom save paths");
  }

  if (isLinux && profile.umuId.trim()) {
    await window.electron.umuSetGameId(gameName, profile.umuId.trim());
  }

  return {
    ...profile,
    savePaths: savePathsResult?.success ? savePathsResult.paths || savePaths : savePaths,
  };
}
