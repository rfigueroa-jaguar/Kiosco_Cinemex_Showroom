import { useEffect, useRef, useCallback } from "react";
import type { Screen } from "@/store/kioskStore";

const EMPTY_MS = 60_000;
const MODAL_MS = 60_000;
const QR_MS = 120_000;

interface Options {
  screen: Screen;
  cartEmpty: boolean;
  paymentActive: boolean;
  modalOpen: boolean;
  onEmptyTimeout: () => void;
  onShowModal: () => void;
  onModalTimeout: () => void;
  onQrTimeout: () => void;
}

export function useInactivityTimer({
  screen,
  cartEmpty,
  paymentActive,
  modalOpen,
  onEmptyTimeout,
  onShowModal,
  onModalTimeout,
  onQrTimeout,
}: Options) {
  const lastActivity = useRef(Date.now());
  const modalOpenedAt = useRef<number | null>(null);
  const qrEnteredAt = useRef<number | null>(null);

  const bump = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    if (modalOpen) {
      modalOpenedAt.current = Date.now();
    } else {
      modalOpenedAt.current = null;
    }
  }, [modalOpen]);

  useEffect(() => {
    if (screen === "qr_scan") {
      qrEnteredAt.current = Date.now();
    } else {
      qrEnteredAt.current = null;
    }
  }, [screen]);

  useEffect(() => {
    const onEvt = () => bump();
    window.addEventListener("pointerdown", onEvt, { passive: true });
    window.addEventListener("keydown", onEvt);
    return () => {
      window.removeEventListener("pointerdown", onEvt);
      window.removeEventListener("keydown", onEvt);
    };
  }, [bump]);

  useEffect(() => {
    if (paymentActive) return;

    if (screen === "welcome") return;

    if (screen === "qr_scan") {
      const id = window.setInterval(() => {
        if (!qrEnteredAt.current) return;
        if (Date.now() - qrEnteredAt.current >= QR_MS) {
          window.clearInterval(id);
          onQrTimeout();
        }
      }, 500);
      return () => window.clearInterval(id);
    }

    const id = window.setInterval(() => {
      if (modalOpen) {
        if (modalOpenedAt.current && Date.now() - modalOpenedAt.current >= MODAL_MS) {
          window.clearInterval(id);
          onModalTimeout();
        }
        return;
      }

      const idle = Date.now() - lastActivity.current;

      if (screen === "catalog" || screen === "payment_method") {
        if (cartEmpty && idle >= EMPTY_MS) {
          window.clearInterval(id);
          onEmptyTimeout();
        } else if (!cartEmpty && idle >= EMPTY_MS) {
          window.clearInterval(id);
          onShowModal();
        }
      }
    }, 400);

    return () => window.clearInterval(id);
  }, [
    screen,
    cartEmpty,
    paymentActive,
    modalOpen,
    onEmptyTimeout,
    onShowModal,
    onModalTimeout,
    onQrTimeout,
  ]);

  return { bumpActivity: bump };
}
