import { Button, Callout, Spinner } from "@blueprintjs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { im30MessageFromApiFail, im30MessageFromPayload } from "@/lib/im30ErrorCatalog";
import { cardSale, setTransactionStep, type ApiResult } from "@/services/api";
import { useKioskStore } from "@/store/kioskStore";
import "./CardPaymentScreen.css";

let cardSaleGeneration = 0;

/**
 * Una sola petición POST /sale por transaction_id a la vez.
 * Evita dobles cobros si React Strict Mode ejecuta el efecto dos veces o si las dependencias del efecto se recalculan.
 */
const cardSaleInFlight = new Map<string, Promise<ApiResult<Record<string, unknown>>>>();

function isApproved(d: Record<string, unknown>): boolean {
  const r = d.respuesta;
  return typeof r === "string" && r.toLowerCase() === "approved";
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
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const applyResult = useCallback(async (r: ApiResult<Record<string, unknown>>, gen: number) => {
    if (gen !== cardSaleGeneration) return;

    if (!r.success) {
      setErr(im30MessageFromApiFail(r));
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

    setErr(im30MessageFromPayload(d));
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

  /** Solo abandona la UI; el Bridge no ofrece cancelación HTTP — la TPV puede seguir hasta timeout. */
  const handleUserCancel = useCallback(() => {
    onCancelRef.current();
  }, []);

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
            <Button minimal fill onClick={handleUserCancel}>
              Cancelar
            </Button>
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
            <Button minimal fill onClick={handleUserCancel}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
