import { Button, Callout, ProgressBar, Spinner } from "@blueprintjs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { cashCancel, cashInitiate, cashPoll } from "@/services/api";
import { useKioskStore } from "@/store/kioskStore";
import "./CashPaymentScreen.css";

const POLL_MS = 200;

/** Evita doble inicio con React 18 StrictMode en desarrollo. */
let cashEffectGeneration = 0;

function pickTxState(d: Record<string, unknown>): string {
  const v =
    d.transactionStatus ?? d.TransactionStatus ?? d.status ?? d.State ?? d.state ?? d.currentStatus;
  return typeof v === "string" ? v : String(v ?? "");
}

function isFatalState(st: string, d: Record<string, unknown>): boolean {
  const u = String(d.fixInstructionsUrl || "");
  if (u) return true;
  const fatal = [
    "Error",
    "Failed",
    "Cancelled",
    "Canceled",
    "NotStartedInsufficientChange",
    "Transaction_Stalled",
    "Jammed",
  ];
  return fatal.some((x) => st.includes(x) || st === x);
}

interface Props {
  amount: number;
  onSuccess: () => void;
  onAbort: () => void;
}

/**
 * Polling CPI: se detiene explícitamente en éxito, cancelación o error fatal (requisito usuario).
 */
export function CashPaymentScreen({ amount, onSuccess, onAbort }: Props) {
  const setPaymentActive = useKioskStore((s) => s.setPaymentActive);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState("Iniciando pago en efectivo…");
  const [accepted, setAccepted] = useState(0);
  const [dispensed, setDispensed] = useState(0);
  const [fixUrl, setFixUrl] = useState<string | null>(null);

  const cpiIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);
  const completedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const finalizeStop = useCallback(() => {
    stoppedRef.current = true;
    stopPolling();
    setBusy(false);
  }, [stopPolling]);

  useEffect(() => {
    const gen = ++cashEffectGeneration;
    setPaymentActive(true);
    stoppedRef.current = false;
    completedRef.current = false;

    const run = async () => {
      if (gen !== cashEffectGeneration) return;
      const init = await cashInitiate();
      if (!init.success) {
        finalizeStop();
        setMsg(init.error || "No se pudo iniciar el cobro");
        return;
      }
      const cpiId = init.data.cpi_transaction_id;
      if (!cpiId) {
        finalizeStop();
        setMsg("Respuesta inválida del CPI");
        return;
      }
      cpiIdRef.current = cpiId;
      setMsg("Inserta billetes o monedas…");

      intervalRef.current = setInterval(async () => {
        if (stoppedRef.current || gen !== cashEffectGeneration) return;
        const r = await cashPoll(cpiId);
        if (!r.success) {
          finalizeStop();
          setMsg(String((r as { error?: string }).error || "Error al consultar el pago"));
          return;
        }
        const d = r.data as Record<string, unknown>;
        const st = pickTxState(d);

        const ta = Number(d.totalAccepted ?? d.TotalAccepted ?? 0);
        const td = Number(d.totalDispensed ?? d.TotalDispensed ?? 0);
        if (!Number.isNaN(ta)) setAccepted(ta / 100);
        if (!Number.isNaN(td)) setDispensed(td / 100);

        const url = d.fixInstructionsUrl ?? d.FixInstructionsUrl;
        if (typeof url === "string" && url) setFixUrl(url);

        if (st === "CompletedSuccess") {
          completedRef.current = true;
          finalizeStop();
          onSuccess();
          return;
        }

        if (isFatalState(st, d)) {
          finalizeStop();
          setMsg(`El pago no pudo continuar (${st}).`);
          return;
        }
      }, POLL_MS);
    };

    void run();

    return () => {
      finalizeStop();
      setPaymentActive(false);
      if (!completedRef.current && cpiIdRef.current) {
        void cashCancel(cpiIdRef.current);
      }
    };
  }, [amount, finalizeStop, onSuccess, setPaymentActive]);

  const onCancelClick = async () => {
    completedRef.current = true;
    finalizeStop();
    const id = cpiIdRef.current;
    if (id) await cashCancel(id);
    setPaymentActive(false);
    onAbort();
  };

  const progress = amount > 0 ? Math.min(1, accepted / amount) : 0;

  return (
    <div className="cash-payment">
      <div className="cash-payment__panel">
        <h2 className="cash-payment__title">Pago en efectivo</h2>
        <p className="cash-payment__subtitle">Total a pagar: ${amount.toFixed(2)}</p>
        {busy && <Spinner size={40} />}
        <p className="cash-payment__msg">{msg}</p>
        <div className="cash-payment__stats">
          <span>Ingresado: ${accepted.toFixed(2)}</span>
          <span>Cambio devuelto: ${dispensed.toFixed(2)}</span>
        </div>
        <ProgressBar value={progress} intent="success" stripes={false} className="cash-payment__bar" />
        {fixUrl && (
          <Callout intent="warning" title="Requiere atención">
            <a href={fixUrl} target="_blank" rel="noreferrer">
              Instrucciones del fabricante
            </a>
          </Callout>
        )}
        <Button fill large intent="danger" disabled={!busy} onClick={() => void onCancelClick()}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
