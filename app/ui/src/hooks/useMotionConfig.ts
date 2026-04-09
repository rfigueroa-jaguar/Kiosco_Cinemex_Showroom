import { useReducedMotion } from "framer-motion";
import { useMemo } from "react";

export function useMotionConfig() {
  const reduced = useReducedMotion();
  return useMemo(
    () => ({
      reduced: !!reduced,
      dur: reduced ? 0.01 : 1,
      fast: reduced ? 0.01 : 0.25,
      stagger: reduced ? 0 : 0.05,
    }),
    [reduced]
  );
}
