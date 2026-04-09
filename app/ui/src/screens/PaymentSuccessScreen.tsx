import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import "./PaymentSuccessScreen.css";

interface Props {
  onContinue: () => void;
}

export function PaymentSuccessScreen({ onContinue }: Props) {
  const m = useMotionConfig();
  const [phase, setPhase] = useState<"anim" | "done">("anim");

  const particles = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        id: i,
        dx: (Math.random() - 0.5) * 140,
        dy: (Math.random() - 0.5) * 140,
      })),
    []
  );

  useEffect(() => {
    if (phase !== "done") return;
    const t = window.setTimeout(onContinue, m.reduced ? 50 : 400);
    return () => window.clearTimeout(t);
  }, [phase, onContinue, m.reduced]);

  return (
    <div className="payment-success">
      <div className="payment-success__inner">
        <motion.svg
          className="payment-success__check"
          viewBox="0 0 48 48"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: m.reduced ? 0.01 : 0.2 }}
        >
          <circle
            cx="24"
            cy="24"
            r="22"
            fill="none"
            stroke="var(--color-status-success)"
            strokeWidth="3"
          />
          <motion.path
            d="M14 24 L21 31 L34 17"
            fill="none"
            stroke="var(--color-status-success)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: m.reduced ? 0.01 : 0.5, delay: m.reduced ? 0 : 0.1 }}
            onAnimationComplete={() => setPhase("done")}
          />
        </motion.svg>
        <div className="payment-success__burst" aria-hidden>
          {particles.map((p) => (
            <motion.div
              key={p.id}
              className="payment-success__particle"
              initial={{ opacity: 0.9, scale: 0.6, x: 0, y: 0 }}
              animate={{
                opacity: 0,
                scale: 1.1,
                x: p.dx,
                y: p.dy,
              }}
              transition={{ duration: m.reduced ? 0.01 : 0.6, ease: "easeOut" }}
            />
          ))}
        </div>
        <p className="payment-success__text">¡Pago recibido!</p>
      </div>
    </div>
  );
}
