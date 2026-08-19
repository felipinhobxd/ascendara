import { useEffect } from "react";
import { createSettingsRecoveryPoint } from "@/services/recoveryService";

export function useRecoveryPointOnUpdate() {
  useEffect(() => {
    // The updater already emits update-ready at the safest point to snapshot settings.
    // Keeping this listener isolated means command palette changes cannot accidentally
    // disable the pre-update recovery behavior.
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
}
