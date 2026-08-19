import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock3, Gamepad2, Layers3, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import recentGamesService from "@/services/recentGamesService";

const SMART_COLLECTIONS_EVENT = "ascendara:open-smart-collections";

function getGameName(game) {
  return game?.game || game?.name || "Unknown Game";
}

function normalizePlayTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

const SmartCollectionsCenter = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [games, setGames] = useState([]);
  const [recentGames, setRecentGames] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState("continue");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleOpen = event => {
      setOpen(true);
      if (event?.detail?.collection) setSelectedCollection(event.detail.collection);
    };
    window.addEventListener(SMART_COLLECTIONS_EVENT, handleOpen);
    return () => window.removeEventListener(SMART_COLLECTIONS_EVENT, handleOpen);
  }, []);

  const loadGames = useCallback(async () => {
    setLoading(true);
    try {
      const [installed, custom] = await Promise.all([
        window.electron.getGames(),
        window.electron.getCustomGames(),
      ]);

      const normalized = [
        ...(Array.isArray(installed)
          ? installed.map(game => ({ ...game, isCustom: false }))
          : []),
        ...(Array.isArray(custom)
          ? custom.map(game => ({
              ...game,
              name: game.game || game.name,
              game: game.game || game.name,
              isCustom: true,
              custom: true,
            }))
          : []),
      ];

      const seen = new Set();
      setGames(
        normalized.filter(game => {
          const key = `${game.isCustom ? "custom" : "installed"}:${getGameName(game)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
      );
      setRecentGames(recentGamesService.getRecentGames());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadGames();
  }, [open, loadGames]);

  const recentByName = useMemo(() => {
    const map = new Map();
    recentGames.forEach(game => map.set(getGameName(game), game));
    return map;
  }, [recentGames]);

  const collections = useMemo(() => {
    const continuePlaying = recentGames
      .map(recent => games.find(game => getGameName(game) === getGameName(recent)))
      .filter(Boolean);

    return [
      {
        id: "continue",
        label: "Continue Playing",
        description: "Games Ascendara has seen you launch most recently.",
        games: continuePlaying,
      },
      {
        id: "never-played",
        label: "Never Played",
        description: "Installed games with no recorded playtime or recent launch.",
        games: games.filter(
          game => normalizePlayTime(game.playTime) <= 0 && !recentByName.has(getGameName(game))
        ),
      },
      {
        id: "played",
        label: "Played",
        description: "Games with recorded playtime or a recent launch.",
        games: games.filter(
          game => normalizePlayTime(game.playTime) > 0 || recentByName.has(getGameName(game))
        ),
      },
      {
        id: "custom",
        label: "Custom Games",
        description: "Games added manually to your Ascendara library.",
        games: games.filter(game => game.isCustom),
      },
      {
        id: "online",
        label: "Online",
        description: "Installed games marked with online support.",
        games: games.filter(game => Boolean(game.online)),
      },
      {
        id: "vr",
        label: "VR",
        description: "Installed games marked for VR.",
        games: games.filter(game => Boolean(game.isVr)),
      },
      {
        id: "dlc",
        label: "DLC",
        description: "Installed entries marked as DLC content.",
        games: games.filter(game => Boolean(game.dlc)),
      },
    ];
  }, [games, recentGames, recentByName]);

  const activeCollection =
    collections.find(collection => collection.id === selectedCollection) || collections[0];

  const openGame = game => {
    setOpen(false);
    // This matches Ascendara's existing library search behavior exactly, so GameScreen
    // receives the same object shape regardless of whether the game came from Library,
    // Ctrl+K, or a Smart Collection.
    navigate("/gamescreen", {
      state: { gameData: game },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[86vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-6 w-6 text-primary" /> Smart Collections
          </DialogTitle>
        </DialogHeader>

        <div className="grid min-h-[560px] grid-cols-[230px_1fr]">
          <aside className="space-y-2 overflow-y-auto border-r border-border bg-muted/20 p-3">
            <Button
              variant="outline"
              className="mb-2 w-full justify-start"
              onClick={loadGames}
              disabled={loading}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh library
            </Button>
            {collections.map(collection => (
              <button
                key={collection.id}
                onClick={() => setSelectedCollection(collection.id)}
                className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  selectedCollection === collection.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{collection.label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {collection.games.length}
                  </Badge>
                </div>
              </button>
            ))}
          </aside>

          <section className="overflow-y-auto p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
                  <Layers3 className="h-5 w-5 text-primary" /> {activeCollection?.label}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeCollection?.description}
                </p>
              </div>
              <Badge variant="outline">{activeCollection?.games.length || 0} games</Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {activeCollection?.games.map(game => {
                const recent = recentByName.get(getGameName(game));
                return (
                  <button
                    key={`${game.isCustom ? "custom" : "installed"}:${getGameName(game)}`}
                    onClick={() => openGame(game)}
                    className="rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-start gap-3">
                      <Gamepad2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{getGameName(game)}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {game.isCustom && <Badge variant="outline">Custom</Badge>}
                          {normalizePlayTime(game.playTime) > 0 && (
                            <span>{normalizePlayTime(game.playTime)} playtime</span>
                          )}
                          {recent?.lastPlayed && (
                            <span className="flex items-center gap-1">
                              <Clock3 className="h-3 w-3" />
                              {new Date(recent.lastPlayed).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {!loading && (activeCollection?.games.length || 0) === 0 && (
              <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
                No games currently match this collection.
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { SMART_COLLECTIONS_EVENT };
export default SmartCollectionsCenter;
