import { Callout } from "@blueprintjs/core";
import { useCallback, useState } from "react";
import { useQRScanner } from "@/hooks/useQRScanner";
import type { TransactionPayload } from "@/services/api";
import "./QrScanScreen.css";

interface Props {
  expectedId: string;
  transaction: TransactionPayload;
  onValid: () => void;
}

export function QrScanScreen({ expectedId, transaction, onValid }: Props) {
  const [err, setErr] = useState<string | null>(null);

  const onScan = useCallback(
    (payload: string) => {
      const id = payload.trim();
      if (id === expectedId) {
        setErr(null);
        onValid();
      } else {
        setErr("QR no válido, intenta de nuevo");
      }
    },
    [expectedId, onValid]
  );

  useQRScanner(true, onScan);

  return (
    <div className="qr-scan">
      <div className="qr-scan__panel">
        <h2 className="qr-scan__title">Escanea tu QR</h2>
        <p className="qr-scan__hint">
          Escanea el QR de tu ticket para ver el resumen de tu compra.
        </p>
        <p className="qr-scan__meta">Transacción: {transaction.transaction_id.slice(0, 8)}…</p>
        {err && (
          <Callout intent="danger" title="Lectura incorrecta">
            {err}
          </Callout>
        )}
      </div>
    </div>
  );
}
