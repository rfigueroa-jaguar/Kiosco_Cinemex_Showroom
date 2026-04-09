import { Button, Callout, ProgressBar, Spinner } from "@blueprintjs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cashCancel,
  cashInitiate,
  cashPoll,
  cashReconciliation,
  type ApiFail,
  type ApiResult,
} from "@/services/api";
import { useKioskStore } from "@/store/kioskStore";
import "./CashPaymentScreen.css";

const POLL_MS = 300;

/** Evita doble inicio con React 18 StrictMode en desarrollo. */
let cashEffectGeneration = 0;

/**
 * Dedup: una sola llamada a POST /api/payment/cash/initiate por kiosk-transaction-id.
 * Previene doble cobro cuando React StrictMode ejecuta el efecto dos veces o cuando
 * las props inline de KioskApp se recrean en un re-render intermedio.
 */
const cashInitiateInFlight = new Map<string, Promise<ApiResult<{ cpi_transaction_id: string }>>>();

/**
 * TransactionDTO.status — enum del schema CPI.
 * Se priorizan los campos en el orden correcto del schema.
 */
function pickTxState(d: Record<string, unknown>): string {
  // 'status' es el nombre canónico en TransactionDTO (schema CPI)
  const v = d.status ?? d.transactionStatus ?? d.TransactionStatus ?? d.State ?? d.state;
  return typeof v === "string" ? v : String(v ?? "");
}

/** Estados del enum TransactionStatus que detienen el flujo definitivamente. */
const FATAL_STATES = new Set([
  "UnknownError",
  "Cancelled",
  "Jammed",
  "PaymentItemStorageFull",
  "NotStartedInsufficientChange",
  "DeviceError",
  "WrongCurrencyError",
  "DevicesNotReady",
  "NotStartedInsufficientAllowedCurrency",
  "NotStartedProhibited",
  "BadRequest",
  "Timeout",
  "ServiceStopped",
  "NotStartedNotSupported",
  "InsufficientChange",
  "NotStartedBusy",
]);

function isFatalState(st: string, d: Record<string, unknown>): boolean {
  if (String(d.fixInstructionsUrl || "")) return true;
  return FATAL_STATES.has(st);
}

/** Errores transitorios del backend que se pueden reintentar. */
function isRetryable(r: ApiFail): boolean {
  const retryFlag = (r as ApiFail & { retry?: boolean }).retry;
  if (retryFlag === true) return true;
  return r.code === "CPI_BUSY" || r.code === "CPI_TX_NOT_STARTED";
}

interface Props {
  amount: number;
  onSuccess: () => void;
  onAbort: () => void;
}

/**
 * Polling CPI: una sola llamada a POST /api/Transactions por transacción.
 * Flujo del proveedor:
 *   1. GET /api/SystemStatus — verificar estado del reciclador (en el backend)
 *   2. POST /api/Transactions — iniciar; el backend verifica status = "InProgress"
 *   3. GET /api/Transactions/{transactionId} cada ~300 ms — monitorear
 *   4. En cancelación: GET /api/Transactions/action/{transactionId}/cancel
 */
export function CashPaymentScreen({ amount, onSuccess, onAbort }: Props) {
  const setPaymentActive = useKioskStore((s) => s.setPaymentActive);
  const transactionId = useKioskStore((s) => s.activeTransaction?.transaction_id ?? null);

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [msg, setMsg] = useState("Verificando reciclador…");
  const [accepted, setAccepted] = useState(0);
  const [dispensed, setDispensed] = useState(0);
  const [fixUrl, setFixUrl] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Refs para callbacks estables — evita que re-renders de KioskApp
  // (que recrean las funciones inline) disparen el efecto de nuevo.
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onAbortRef = useRef(onAbort);
  onAbortRef.current = onAbort;

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
    if (!transactionId) {
      setBusy(false);
      setErr("Sin transacción activa.");
      return;
    }

    const gen = ++cashEffectGeneration;
    setPaymentActive(true);
    stoppedRef.current = false;
    completedRef.current = false;
    cpiIdRef.current = null;
    setErr(null);
    setRetryable(false);
    setAccepted(0);
    setDispensed(0);
    setFixUrl(null);
    setBusy(true);
    setMsg("Verificando reciclador…");

    const run = async () => {
      if (gen !== cashEffectGeneration) return;

      // Dedup: reutilizar promesa en curso para este transaction_id
      let p = cashInitiateInFlight.get(transactionId);
      if (!p) {
        p = cashInitiate().finally(() => cashInitiateInFlight.delete(transactionId));
        cashInitiateInFlight.set(transactionId, p);
      }
      const init = await p;

      // Verificar que este efecto sigue siendo el activo (StrictMode guard)
      if (gen !== cashEffectGeneration) return;

      if (!init.success) {
        finalizeStop();
        setErr(init.error || "No se pudo iniciar el cobro");
        setRetryable(isRetryable(init));
        return;
      }
      const cpiId = init.data.cpi_transaction_id;
      if (!cpiId) {
        finalizeStop();
        setErr("Respuesta inválida del reciclador. Intenta de nuevo.");
        setRetryable(true);
        return;
      }
      cpiIdRef.current = cpiId;
      setMsg("Inserta billetes o monedas…");

      intervalRef.current = setInterval(async () => {
        if (stoppedRef.current || gen !== cashEffectGeneration) return;
        const r = await cashPoll(cpiId);
        if (!r.success) {
          finalizeStop();
          setErr((r as ApiFail).error || "Error al consultar el pago");
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
          const taI = Math.round(Number.isFinite(ta) ? ta : 0);
          const tdI = Math.round(Number.isFinite(td) ? td : 0);
          const expectedCents = Math.round(amount * 100);
          const tvRaw = d.transactionValue ?? d.TransactionValue;
          const tv = typeof tvRaw === "number" && Number.isFinite(tvRaw) ? tvRaw : undefined;
          if (transactionId) {
            await cashReconciliation({
              transaction_id: transactionId,
              cpi_transaction_id: cpiId,
              total_accepted: taI,
              total_dispensed: tdI,
              expected_cents: expectedCents,
              transaction_value: tv,
              status: st,
            });
          }
          completedRef.current = true;
          finalizeStop();
          onSuccessRef.current();
          return;
        }

        if (isFatalState(st, d)) {
          finalizeStop();
          const detail = typeof d.errorMessage === "string" && d.errorMessage ? ` (${d.errorMessage})` : "";
          setErr(`El pago no pudo continuar (${st})${detail}.`);
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
    // onSuccess / onAbort se leen via ref — NO van en deps para evitar re-ejecuciones
    // causadas por las funciones inline de KioskApp que se recrean en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, amount, finalizeStop, setPaymentActive, retryKey]);

  const onRetryClick = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  const onCancelClick = useCallback(async () => {
    completedRef.current = true;
    finalizeStop();
    const id = cpiIdRef.current;
    if (id) await cashCancel(id);
    setPaymentActive(false);
    onAbortRef.current();
  }, [finalizeStop, setPaymentActive]);

  const progress = amount > 0 ? Math.min(1, accepted / amount) : 0;

  return (
    <div className="cash-payment">
      <div className="cash-payment__panel">
        <h2 className="cash-payment__title">Pago en efectivo</h2>
        <p className="cash-payment__subtitle">Total a pagar: ${amount.toFixed(2)}</p>
        {busy && <Spinner size={40} />}
        {!err && <p className="cash-payment__msg">{msg}</p>}
        {err && (
          <Callout intent="danger" title="No se pudo procesar el pago">
            {err}
          </Callout>
        )}
        {!err && (
          <div className="cash-payment__stats">
            <span>Ingresado: ${accepted.toFixed(2)}</span>
            <span>Cambio devuelto: ${dispensed.toFixed(2)}</span>
          </div>
        )}
        <ProgressBar value={progress} intent="success" stripes={false} className="cash-payment__bar" />
        {fixUrl && (
          <Callout intent="warning" title="Requiere atención">
            <a href={fixUrl} target="_blank" rel="noreferrer">
              Instrucciones del fabricante
            </a>
          </Callout>
        )}
        {!busy && (
          <div className="cash-payment__actions">
            {retryable && (
              <Button intent="primary" large fill onClick={onRetryClick}>
                Reintentar
              </Button>
            )}
            <Button
              fill
              large
              intent={retryable ? "none" : "danger"}
              minimal={retryable}
              onClick={() => void onCancelClick()}
            >
              Cancelar
            </Button>
          </div>
        )}
        {busy && (
          <Button fill large intent="danger" onClick={() => void onCancelClick()}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
