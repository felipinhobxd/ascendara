const SAFE_MODE_KEY = "ascendara:safe-ui-mode";
const SAFE_MODE_STYLE_ID = "ascendara-safe-ui-mode-style";

function ensureSafeModeStyle() {
  if (typeof document === "undefined" || document.getElementById(SAFE_MODE_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = SAFE_MODE_STYLE_ID;
  style.textContent = `
    html.ascendara-safe-ui *,
    html.ascendara-safe-ui *::before,
    html.ascendara-safe-ui *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  `;
  document.head.appendChild(style);
}

export function isSafeUiModeEnabled() {
  try {
    return localStorage.getItem(SAFE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function applySafeUiMode(enabled = isSafeUiModeEnabled()) {
  if (typeof document === "undefined") return false;

  ensureSafeModeStyle();
  document.documentElement.classList.toggle("ascendara-safe-ui", Boolean(enabled));
  return Boolean(enabled);
}

export function setSafeUiMode(enabled) {
  try {
    if (enabled) localStorage.setItem(SAFE_MODE_KEY, "1");
    else localStorage.removeItem(SAFE_MODE_KEY);
  } catch (error) {
    console.warn("[Recovery] Could not persist Safe UI Mode:", error);
  }

  return applySafeUiMode(enabled);
}

export function clearTransientUiState() {
  // These keys only control temporary UI flows. User library, sources, credentials,
  // backups and settings deliberately stay untouched by recovery actions.
  const transientKeys = [
    "forceLoading",
    "forceInstalling",
    "finishingUp",
    "ascendara:startTour",
  ];

  for (const key of transientKeys) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {}
  }
}

export function initializeRecoveryMode() {
  applySafeUiMode();
}
