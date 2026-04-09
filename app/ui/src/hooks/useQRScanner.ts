import { useEffect, useRef } from "react";

/**
 * Modo HID — buffer global hasta Enter (PRD §8.8).
 * `enabled` solo true en pantalla QR.
 */
export function useQRScanner(enabled: boolean, onScan: (payload: string) => void) {
  const buf = useRef("");

  useEffect(() => {
    if (!enabled) {
      buf.current = "";
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const v = buf.current.trim();
        buf.current = "";
        if (v) onScan(v);
        return;
      }
      if (e.key.length === 1) {
        buf.current += e.key;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onScan]);
}
