import { Button, Classes, Dialog } from "@blueprintjs/core";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useMotionConfig } from "@/hooks/useMotionConfig";
import "./InactivityModal.css";

interface Props {
  isOpen: boolean;
  onContinue: () => void;
  onCancelPurchase: () => void;
  onTimeout: () => void;
}

const SECONDS = 60;

export function InactivityModal({ isOpen, onContinue, onCancelPurchase, onTimeout }: Props) {
  const m = useMotionConfig();
  const [left, setLeft] = useState(SECONDS);
  const fired = useRef(false);
  // Evita reiniciar el intervalo cuando el padre re-renderiza y pasa nuevas refs de función.
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    fired.current = false;
    if (!isOpen) {
      setLeft(SECONDS);
      return;
    }
    setLeft(SECONDS);
    const id = window.setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          if (!fired.current) {
            fired.current = true;
            onTimeoutRef.current();
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [isOpen]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onContinue}
      title="¿Sigues ahí?"
      className="inactivity-dialog"
      canOutsideClickClose={false}
    >
      <div className={Classes.DIALOG_BODY}>
        <p className="inactivity-dialog__msg">
          Tu sesión está a punto de cancelarse. ¿Deseas continuar con tu compra?
        </p>
        <motion.div
          className="inactivity-dialog__counter"
          key={left}
          initial={{ scale: 1 }}
          animate={{ scale: m.reduced ? 1 : [1, 1.05, 1] }}
          transition={{ duration: m.reduced ? 0.01 : 0.35 }}
        >
          {left}s
        </motion.div>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button text="Cancelar compra" intent="danger" onClick={onCancelPurchase} />
          <Button intent="primary" text="Continuar comprando" onClick={onContinue} />
        </div>
      </div>
    </Dialog>
  );
}
