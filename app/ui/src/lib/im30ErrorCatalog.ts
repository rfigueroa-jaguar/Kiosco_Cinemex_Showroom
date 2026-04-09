/**
 * Mensajes de error para pago con tarjeta (IM30 / EMVBridge / TPV).
 * Alineado con integracion_im30.md — catálogos PIN pad, MiTec y Bridge.
 *
 * Campos observados en respuestas reales del EMVBridge:
 *   chkPpCdError  — código PIN pad del SDK  (ej. "11" = timeout, "10" = cancelado)
 *   chkPpDsError  — descripción textual del SDK (ej. "Proceso cancelado por timeout.")
 *   errorCode     — código string del Bridge (ej. "EMV_START_FAILED", "SALE_DENIED"); puede enmascarar el real
 *   rspCdError    — código de respuesta del autorizador (puede contener código adicional de rechazo)
 *   rspDsError    — descripción textual del rechazo del autorizador
 *   mitIm30       — objeto o string con contexto adicional de la plataforma MiTec
 *   respuesta     — resultado: "approved" | "denied" | "cancelled" | "timeout"
 */

import type { ApiFail } from "@/services/api";

// ─── Catálogos públicos ───────────────────────────────────────────────────────

/** Catálogo — PIN Pad (terminal física). integracion_im30.md § Catálogo PIN Pad */
export const IM30_PIN_PAD_UI: Record<string, string> = {
  "01": "No pudimos leer tu tarjeta. Intenta con otra.",
  "03": "Terminal no disponible. Llama a soporte.",
  "10": "Operación cancelada en la terminal.",
  "11": "Tiempo agotado en la terminal. Puedes intentar de nuevo.",
  "14": "Error al procesar el PIN. Intenta de nuevo.",
  "15": "Tu tarjeta está vencida. Usa otra.",
  "17": "Avísale al personal: la impresora de la terminal necesita papel.",
  "22": "Tarjeta bloqueada. Comunícate con tu banco.",
  "27": "PIN bloqueado. Comunícate con tu banco.",
  "29": "Retiraste la tarjeta demasiado pronto. Intenta de nuevo.",
  "34": "Mantén la tarjeta hasta que se indique.",
  Q100: "Terminal no disponible. Revisa la conexión.",
};

/**
 * Catálogo — Plataforma MiTec. integracion_im30.md § Plataforma MiTec
 * Nota: "11" aquí = transacción duplicada. En PIN pad "11" = timeout.
 * El código resuelve la ambigüedad vía `resolveCode11`.
 */
export const IM30_MITEC_PLATFORM_UI: Record<string, string> = {
  "01": "Error de validación con el banco. Si persiste, contacta a soporte.",
  "03": "Datos del comercio o usuario incorrectos. Un operador debe revisar la configuración MiTec.",
  "04": "Tarjeta no aceptada.",
  "06": "Tarjeta no compatible.",
  "08": "Monto insuficiente para este método de pago.",
  "09": "El monto supera el límite permitido. Consulta con el operador.",
  "11": "Transacción duplicada (mismo día, referencia e importe). Espera un momento o contacta a soporte.",
  "18": "Sin conexión, intenta de nuevo.",
  "19": "Sin conexión, intenta de nuevo.",
  "99": "El servicio de pagos no está disponible. Intenta más tarde o usa otro método de pago.",
  "201": "Los datos del pago no son válidos. Intenta de nuevo o contacta a soporte.",
};

/** Catálogo — errorCode string del Bridge. integracion_im30.md § Bridge string */
export const IM30_BRIDGE_STRING_UI: Record<string, string> = {
  SALE_DENIED: "Pago rechazado por el banco. Verifica con tu institución o intenta con otra tarjeta.",
  SALE_CANCELLED: "Operación cancelada en la terminal.",
  SALE_TIMEOUT: "Tiempo agotado en la terminal. Puedes intentar de nuevo.",
  EMV_START_FAILED:
    "No se pudo iniciar el cobro en la terminal. Comprueba que la TPV esté encendida, conectada y lista; luego intenta de nuevo.",
  EMV_BUSY: "La terminal está ocupada. Espera unos segundos e intenta de nuevo.",
  UNAUTHORIZED:
    "Error de seguridad con el servicio de terminal. Un operador debe revisar el token del EMVBridge.",
  SDK_NOT_AUTHENTICATED:
    "La sesión del servicio de pagos no está activa. Espera un momento e intenta de nuevo; si persiste, reinicia EMVBridge o vuelve a iniciar sesión.",
  LOGIN_FAILED:
    "Usuario o contraseña MiTec incorrectos. Un operador debe revisar las credenciales en la configuración.",
  INVALID_JSON:
    "Error interno al comunicarse con la terminal. Contacta a soporte técnico.",
  INVALID_BODY:
    "Error interno al comunicarse con la terminal. Contacta a soporte técnico.",
  NOT_FOUND:
    "Error interno: ruta del servicio de terminal incorrecta. Contacta a soporte técnico.",
  INTERNAL_ERROR:
    "Error interno en el servicio de la terminal. Intenta de nuevo; si persiste, revisa el log del EMVBridge.",
};

/** Catálogo — códigos que devuelve el backend FastAPI cuando falla IM30. */
export const IM30_BACKEND_API_CODE_UI: Record<string, string> = {
  IM30_LOGIN:
    "No se pudo iniciar sesión con el servicio de pagos. Un operador debe revisar usuario y contraseña MiTec en la configuración.",
  IM30_CLIENT:
    "El servicio de terminal no está disponible. Reinicia la aplicación o contacta a soporte.",
  EMV_BUSY: IM30_BRIDGE_STRING_UI.EMV_BUSY,
  IM30_HTTP:
    "La terminal devolvió un error. Revisa el mensaje detallado o intenta de nuevo.",
  IM30_BAD_JSON:
    "Respuesta inválida del servicio de terminal. Intenta de nuevo o revisa EMVBridge.",
  CARD_ERROR: "No se pudo procesar el pago con tarjeta. Intenta de nuevo.",
  NO_CARD_TX:
    "La transacción con tarjeta no está preparada. Vuelve a elegir el método de pago.",
};

// ─── Constantes internas ──────────────────────────────────────────────────────

/**
 * Campos del JSON que pueden contener un código de error.
 * Orden: campos específicos del SDK/TPV primero, genérico `errorCode` al final.
 * `chkPpCdError` es el campo real del EMVBridge para el código PIN pad
 * (descubierto en producción: "11" = timeout, "10" = cancelado).
 */
const CODE_HINT_KEYS = [
  "pinPadErrorCode",
  "platformErrorCode",
  "chkPpCdError",
  "rspCdError",
  "codigoTerminal",
  "terminalCode",
  "codigoError",
  "platformCode",
  "code",
  "errorCode",
  "error_code",
] as const;

/** Campos de objetos anidados que el Bridge puede incluir con información adicional. */
const NEST_KEYS = [
  "data",
  "error",
  "details",
  "detail",
  "result",
  "payload",
  "inner",
] as const;

const DEFAULT_FALLBACK = "No se pudo completar el pago.";
const DEFAULT_API_FAIL = "Error de terminal";

// ─── Utilidades internas ──────────────────────────────────────────────────────

/** Normaliza un valor de campo a clave de catálogo: número → "01"; texto → MAYÚSCULAS. */
function normalizeLookupKey(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.trunc(v);
    return n >= 0 && n <= 99 ? String(n).padStart(2, "0") : String(n);
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^Q\d+$/i.test(s)) return s.toUpperCase();
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, "0");
  if (/^\d+$/.test(s)) return s;
  return s.toUpperCase();
}

/** Recorre el JSON en profundidad siguiendo NEST_KEYS. Evita ciclos con `seen`. */
function collectRecords(
  root: Record<string, unknown>,
  maxDepth = 4,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();

  function walk(o: Record<string, unknown>, depth: number) {
    if (depth < 0 || seen.has(o)) return;
    seen.add(o);
    out.push(o);
    if (depth === 0) return;
    for (const k of NEST_KEYS) {
      const v = o[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Record<string, unknown>, depth - 1);
      }
    }
  }

  walk(root, maxDepth);
  return out;
}

/** Serializa un objeto a JSON en minúsculas para búsqueda de palabras clave. */
function jsonBlob(o: Record<string, unknown>): string {
  try {
    return JSON.stringify(o).toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Resuelve la ambigüedad del código "11":
 * - PIN pad → timeout (caso más frecuente en flujos de venta)
 * - MiTec   → transacción duplicada
 * Devuelve "mit_duplicate" solo si se detecta la palabra "duplicado" en el JSON.
 */
function resolveCode11(
  records: Record<string, unknown>[],
): "pin_timeout" | "mit_duplicate" {
  const RE_DUP = /duplicad|duplicate|duplicat/i;
  for (const r of records) {
    if (typeof r.mitIm30 === "string" && RE_DUP.test(r.mitIm30)) return "mit_duplicate";
  }
  for (const r of records) {
    if (RE_DUP.test(jsonBlob(r))) return "mit_duplicate";
  }
  return "pin_timeout";
}

/**
 * Extrae texto de diagnóstico del Bridge cuando el código es EMV_START_FAILED.
 * Revisa `chkPpDsError` (string) y `mitIm30` (string u objeto) en todos los registros.
 * Devuelve el primer texto útil encontrado, o cadena vacía si no hay ninguno.
 */
function emvStartFailedHint(records: Record<string, unknown>[]): string {
  for (const r of records) {
    if (typeof r.chkPpDsError === "string" && r.chkPpDsError.trim()) {
      return r.chkPpDsError.trim();
    }
    const mit = r.mitIm30;
    if (typeof mit === "string" && mit.trim()) return mit.trim();
    if (mit && typeof mit === "object" && !Array.isArray(mit)) {
      return jsonBlob(mit as Record<string, unknown>);
    }
  }
  return "";
}

/** Busca en los catálogos PIN pad y MiTec por clave normalizada. */
function lookupCatalogs(key: string): string | undefined {
  return IM30_PIN_PAD_UI[key] ?? IM30_MITEC_PLATFORM_UI[key];
}

/** Busca en el catálogo de códigos string del Bridge (insensible a mayúsculas). */
function lookupBridge(key: string): string | undefined {
  return IM30_BRIDGE_STRING_UI[key.toUpperCase()];
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Resuelve un mensaje legible a partir del cuerpo JSON de `/emv/sale` o campos anidados.
 *
 * Estrategia (en orden de prioridad):
 *
 * 1. Códigos PIN pad 10 / 11 — máxima prioridad, se escanean TODOS los niveles del JSON
 *    antes de cualquier otro código. El EMVBridge reporta el código real en `chkPpCdError`
 *    (ej. "11") junto a un `errorCode: "EMV_START_FAILED"` genérico; el código real gana.
 *
 * 2. Demás catálogos (PIN pad, MiTec, Bridge string). Si el código es `EMV_START_FAILED`,
 *    se inspecciona `chkPpDsError` / `mitIm30` para detectar timeout o cancelación antes
 *    de mostrar el mensaje genérico de "TPV no lista".
 *
 * 3. Campo `respuesta` — "denied" | "cancelled" | "timeout".
 *
 * 4. Fallback genérico.
 */
export function im30MessageFromPayload(d: Record<string, unknown>): string {
  const records = collectRecords(d);

  // 1 — PIN pad 10 / 11: prioridad máxima en todos los registros y campos.
  for (const r of records) {
    for (const k of CODE_HINT_KEYS) {
      const key = normalizeLookupKey(r[k]);
      if (!key) continue;
      if (key === "10") return IM30_PIN_PAD_UI["10"];
      if (key === "11") {
        return resolveCode11(records) === "mit_duplicate"
          ? IM30_MITEC_PLATFORM_UI["11"]
          : IM30_PIN_PAD_UI["11"];
      }
    }
  }

  // 2 — Demás catálogos.
  for (const r of records) {
    for (const k of CODE_HINT_KEYS) {
      const key = normalizeLookupKey(r[k]);
      if (!key) continue;

      const catalog = lookupCatalogs(key);
      if (catalog) return catalog;

      if (key === "EMV_START_FAILED") {
        const hint = emvStartFailedHint(records);
        if (/tiempo|timeout|agotado|expir/i.test(hint)) return IM30_PIN_PAD_UI["11"];
        if (/cancel/i.test(hint)) return IM30_PIN_PAD_UI["10"];
        return IM30_BRIDGE_STRING_UI.EMV_START_FAILED;
      }

      const bridge = lookupBridge(key);
      if (bridge) return bridge;
    }
  }

  // 3 — Campo respuesta.
  for (const r of records) {
    const resp = typeof r.respuesta === "string" ? r.respuesta.toLowerCase() : "";
    if (resp === "denied") return "Pago rechazado por el banco.";
    if (resp === "cancelled" || resp === "canceled") return "Operación cancelada.";
    if (resp === "timeout") return IM30_PIN_PAD_UI["11"];
  }

  return DEFAULT_FALLBACK;
}

/**
 * Resuelve un mensaje cuando el backend devuelve `success: false` en el cobro con tarjeta.
 * Recorre `details` (objeto completo), `error` (objeto) y el código de la API antes del fallback.
 */
export function im30MessageFromApiFail(r: ApiFail): string {
  if (r.details && typeof r.details === "object" && !Array.isArray(r.details)) {
    const m = im30MessageFromPayload(r.details as Record<string, unknown>);
    if (m !== DEFAULT_FALLBACK) return m;
  }

  if (r.error && typeof r.error === "object") {
    const m = im30MessageFromPayload(r.error as Record<string, unknown>);
    if (m !== DEFAULT_FALLBACK) return m;
  }

  if (typeof r.error === "string" && r.error.trim()) return r.error.trim();

  const code = typeof r.code === "string" ? r.code.trim() : "";
  if (code && IM30_BACKEND_API_CODE_UI[code]) return IM30_BACKEND_API_CODE_UI[code];

  return DEFAULT_API_FAIL;
}

/** Indica si el payload tiene un error reconocido más allá del mensaje genérico. */
export function im30PayloadHasKnownError(d: Record<string, unknown>): boolean {
  return im30MessageFromPayload(d) !== DEFAULT_FALLBACK;
}
