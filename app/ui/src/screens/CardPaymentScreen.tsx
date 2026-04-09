import { Button, Callout, Spinner } from "@blueprintjs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { cardSale, setTransactionStep, type ApiFail, type ApiResult } from "@/services/api";
import { useKioskStore } from "@/store/kioskStore";
import "./CardPaymentScreen.css";

let cardSaleGeneration = 0;

/**
 * Una sola petición POST /sale por transaction_id a la vez.
 * Evita dobles cobros si React Strict Mode ejecuta el efecto dos veces o si las dependencias del efecto se recalculan.
 */
const cardSaleInFlight = new Map<string, Promise<ApiResult<Record<string, unknown>>>>();

/** Códigos `errorCode` en string devueltos por EMVBridge (además de los numéricos MiTec / PIN pad). */
const BRIDGE_ERROR_UI: Record<string, string> = {
  EMV_START_FAILED:
    "No se pudo iniciar el cobro en la terminal. Comprueba que la TPV esté encendida, conectada y lista; luego intenta de nuevo.",
  EMV_BUSY: "La terminal está ocupada. Espera unos segundos e intenta de nuevo.",
};

function mapCardError(d: Record<string, unknown>): string {
  const mit = d.mitIm30;
  if (typeof mit === "string" && mit.trim()) return mit;

  const ecRaw = d.errorCode ?? d.error_code;
  const ec = ecRaw != null ? String(ecRaw).trim() : "";
  if (ec === "10") return "Operación cancelada en la terminal.";
  if (ec === "11") return "Tiempo agotado en la terminal. Puedes intentar de nuevo.";
  const bridgeMsg = ec ? BRIDGE_ERROR_UI[ec.toUpperCase()] : undefined;
  if (bridgeMsg) return bridgeMsg;
  if (ec) return `Código: ${ec}`;

  const resp = typeof d.respuesta === "string" ? d.respuesta.toLowerCase() : "";
  if (resp === "denied") return "Pago rechazado por el banco.";
  if (resp === "cancelled" || resp === "canceled") return "Operación cancelada.";
  if (resp === "timeout") return "Tiempo agotado. Puedes intentar de nuevo.";

  return "No se pudo completar el pago.";
}

function isApproved(d: Record<string, unknown>): boolean {
  const r = d.respuesta;
  return typeof r === "string" && r.toLowerCase() === "approved";
}

function messageFromApiFail(r: ApiFail): string {
  const e = r.error;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.mitIm30 === "string" && o.mitIm30.trim()) return o.mitIm30;
    const fromFields = mapCardError(o);
    if (fromFields !== "No se pudo completar el pago.") return fromFields;
  }
  const det = r.details;
  if (det && typeof det === "object" && !Array.isArray(det)) {
    const nested = (det as { data?: unknown }).data;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const m = mapCardError(nested as Record<string, unknown>);
      if (m !== "No se pudo completar el pago.") return m;
    }
    const m = mapCardError(det as Record<string, unknown>);
    if (m !== "No se pudo completar el pago.") return m;
  }
  return "Error de terminal";
}

interface Props {
  onApproved: () => void;
  onCancel: () => void;
}

export function CardPaymentScreen({ onApproved, onCancel }: Props) {
  const setPaymentActive = useKioskStore((s) => s.setPaymentActive);
  const transactionId = useKioskStore((s) => s.activeTransaction?.transaction_id ?? null);

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const onApprovedRef = useRef(onApproved);
  onApprovedRef.current = onApproved;

  const applyResult = useCallback(async (r: ApiResult<Record<string, unknown>>, gen: number) => {
    if (gen !== cardSaleGeneration) return;

    if (!r.success) {
      setErr(messageFromApiFail(r));
      setBusy(false);
      return;
    }

    const d = (r.data ?? {}) as Record<string, unknown>;
    if (isApproved(d)) {
      await setTransactionStep({
        step: "printing",
        authorization: String(d.autorizacion ?? ""),
        voucher: String(d.voucher ?? ""),
        last_four: d.lastFour ? String(d.lastFour) : undefined,
      });
      if (gen !== cardSaleGeneration) return;
      onApprovedRef.current();
      return;
    }

    setErr(mapCardError(d));
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!transactionId) {
      setBusy(false);
      setErr("Sin transacción activa.");
      return;
    }

    const gen = ++cardSaleGeneration;
    setPaymentActive(true);
    let cancelled = false;

    const run = async () => {
      setBusy(true);
      setErr(null);

      let p = cardSaleInFlight.get(transactionId);
      if (!p) {
        p = cardSale({}).finally(() => {
          cardSaleInFlight.delete(transactionId);
        });
        cardSaleInFlight.set(transactionId, p);
      }

      const r = await p;
      if (cancelled || gen !== cardSaleGeneration) return;
      await applyResult(r, gen);
    };

    void run();

    return () => {
      cancelled = true;
      setPaymentActive(false);
    };
  }, [transactionId, setPaymentActive, applyResult]);

  const retry = useCallback(() => {
    if (!transactionId) return;
    cardSaleInFlight.delete(transactionId);
    const gen = ++cardSaleGeneration;
    setErr(null);
    setBusy(true);

    void (async () => {
      const p = cardSale({}).finally(() => {
        cardSaleInFlight.delete(transactionId);
      });
      cardSaleInFlight.set(transactionId, p);
      const r = await p;
      if (gen !== cardSaleGeneration) return;
      await applyResult(r, gen);
    })();
  }, [transactionId, applyResult]);

  return (
    <div className="card-payment">
      <div className="card-payment__panel">
        <h2 className="card-payment__title">Pago con tarjeta</h2>
        {busy && (
          <>
            <Spinner size={50} />
            <p className="card-payment__hint">Acerca tu tarjeta a la terminal</p>
          </>
        )}
        {err && (
          <Callout intent="danger" title="No se completó el pago">
            {err}
          </Callout>
        )}
        {!busy && (
          <div className="card-payment__actions">
            <Button intent="primary" large fill onClick={() => retry()}>
              Reintentar
            </Button>
            <Button minimal fill onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
