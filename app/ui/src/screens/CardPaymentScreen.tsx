import { Button, Callout, Spinner } from "@blueprintjs/core";
import { useCallback, useEffect, useState } from "react";
import { cardSale, setTransactionStep } from "@/services/api";
import { useKioskStore } from "@/store/kioskStore";
import "./CardPaymentScreen.css";

let cardSaleGeneration = 0;

interface Props {
  onApproved: () => void;
  onCancel: () => void;
}

function mapCardError(d: Record<string, unknown>): string {
  const mit = d.mitIm30;
  if (typeof mit === "string" && mit) return mit;
  const ec = d.errorCode;
  if (ec) return `Código: ${String(ec)}`;
  if (d.respuesta === "denied") return "Pago rechazado por el banco.";
  return "No se pudo completar el pago.";
}

export function CardPaymentScreen({ onApproved, onCancel }: Props) {
  const setPaymentActive = useKioskStore((s) => s.setPaymentActive);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const handleResult = useCallback(
    async (r: Awaited<ReturnType<typeof cardSale>>, gen: number) => {
      if (gen !== cardSaleGeneration) return;
      if (!r.success) {
        setErr(typeof r.error === "string" ? r.error : "Error de terminal");
        setBusy(false);
        return;
      }
      const d = r.data as Record<string, unknown>;
      if (d.respuesta === "approved") {
        await setTransactionStep({
          step: "printing",
          authorization: String(d.autorizacion ?? ""),
          voucher: String(d.voucher ?? ""),
          last_four: d.lastFour ? String(d.lastFour) : undefined,
        });
        if (gen !== cardSaleGeneration) return;
        onApproved();
        return;
      }
      setErr(mapCardError(d));
      setBusy(false);
    },
    [onApproved]
  );

  useEffect(() => {
    const gen = ++cardSaleGeneration;
    setPaymentActive(true);
    let cancelled = false;

    const run = async () => {
      setBusy(true);
      setErr(null);
      const r = await cardSale({});
      if (cancelled || gen !== cardSaleGeneration) return;
      await handleResult(r, gen);
    };

    void run();

    return () => {
      cancelled = true;
      setPaymentActive(false);
    };
  }, [handleResult, setPaymentActive]);

  const retry = () => {
    const gen = ++cardSaleGeneration;
    setErr(null);
    setBusy(true);
    void (async () => {
      const r = await cardSale({});
      await handleResult(r, gen);
    })();
  };

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
