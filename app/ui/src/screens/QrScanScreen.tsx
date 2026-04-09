import { Button, Callout } from "@blueprintjs/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { logScanAttempt, type TransactionPayload } from "@/services/api";
import "./QrScanScreen.css";

const UUID_IN_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const UUID_LINE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Varios lectores HID mapean el guión del QR a apóstrofo (39) u otros trazos Unicode.
 */
function normalizeForUuidMatch(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/[''`´]/g, "-")
    .replace(/[\u2010-\u2015]/g, "-");
}

function transactionIdFromScan(raw: string): string | null {
  const t = normalizeForUuidMatch(raw);
  if (!t) return null;
  const m = t.match(UUID_IN_TEXT);
  if (m) return m[0].toLowerCase();
  const compact = t.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (/^[0-9a-f]{32}$/.test(compact)) {
    return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  }
  return null;
}

function codepointsHead(s: string, n = 96): number[] {
  const out: number[] = [];
  const lim = Math.min(s.length, n);
  for (let i = 0; i < lim; i++) out.push(s.charCodeAt(i));
  return out;
}

interface Props {
  expectedId: string;
  transaction: TransactionPayload;
  onValid: () => void;
  onGoHome: () => void;
}

export function QrScanScreen({ expectedId, transaction, onValid, onGoHome }: Props) {
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanOkRef = useRef(false);

  const clearIdleTimer = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const onScan = useCallback(
    (payload: string) => {
      const scanned = transactionIdFromScan(payload);
      const expected = expectedId.trim().toLowerCase();
      const ok = Boolean(scanned && scanned === expected);
      logScanAttempt({
        raw: payload,
        expected_transaction_id: expected,
        extracted_transaction_id: scanned,
        ok,
        codepoints_head: codepointsHead(payload),
      });
      if (ok) {
        scanOkRef.current = true;
        clearIdleTimer();
        const el = inputRef.current;
        if (el) el.value = "";
        setErr(null);
        onValid();
      } else {
        if (import.meta.env.DEV) {
          console.warn("[QrScan] lectura no coincide con transacción activa", {
            esperado: expected,
            extraído: scanned,
            longitud: payload.length,
            muestra: payload.slice(0, 64),
          });
        }
        setErr("QR no válido, intenta de nuevo");
      }
    },
    [clearIdleTimer, expectedId, onValid]
  );

  const flushInput = useCallback(() => {
    clearIdleTimer();
    const el = inputRef.current;
    if (!el) return;
    const v = el.value.trim();
    el.value = "";
    if (v) onScan(v);
  }, [clearIdleTimer, onScan]);

  const scheduleAutoFlushIfComplete = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const v = normalizeForUuidMatch(el.value);
    if (v.length !== 36 || !UUID_LINE.test(v)) {
      clearIdleTimer();
      return;
    }
    clearIdleTimer();
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      const el2 = inputRef.current;
      if (!el2) return;
      const t = normalizeForUuidMatch(el2.value);
      if (t.length === 36 && UUID_LINE.test(t)) {
        const rawCaptured = el2.value;
        el2.value = "";
        onScan(rawCaptured);
      }
    }, 85);
  }, [clearIdleTimer, onScan]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const refocus = () => {
      if (scanOkRef.current) return;
      requestAnimationFrame(() => {
        if (scanOkRef.current) return;
        if (document.activeElement !== el) el.focus();
      });
    };
    el.focus();
    el.addEventListener("blur", refocus);
    return () => el.removeEventListener("blur", refocus);
  }, []);

  return (
    <div className="qr-scan">
      <input
        ref={inputRef}
        type="text"
        className="qr-scan__capture"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        tabIndex={-1}
        aria-hidden
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            flushInput();
          }
        }}
        onInput={scheduleAutoFlushIfComplete}
      />
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
        <div className="qr-scan__actions">
          <Button large fill minimal onClick={onGoHome}>
            Ir al inicio
          </Button>
        </div>
      </div>
    </div>
  );
}
