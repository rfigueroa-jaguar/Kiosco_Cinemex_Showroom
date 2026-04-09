/**
 * Mensajes de error para pago con tarjeta (IM30 / EMVBridge / TPV).
 * Alineado con integracion_im30.md — catálogos Bridge HTTP, Bridge string, MiTec y PIN pad.
 */

import type { ApiFail } from "@/services/api";

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

/** Catálogo — Plataforma MiTec (general). integracion_im30.md § Plataforma MiTec */
export const IM30_MITEC_PLATFORM_UI: Record<string, string> = {
  "01": "Error de validación con el banco. Si persiste, contacta a soporte.",
  "03": "Datos del comercio o usuario incorrectos. Un operador debe revisar la configuración MiTec.",
  "04": "Tarjeta no aceptada.",
  "06": "Tarjeta no compatible.",
  "08": "Monto insuficiente para este método de pago.",
  "09": "El monto supera el límite permitido. Consulta con el operador.",
  /** En venta con TPV suele ser timeout; si el texto indica duplicado, se sobrescribe abajo. */
  "11": "Transacción duplicada (mismo día, referencia e importe). Espera un momento o contacta a soporte.",
  "18": "Sin conexión, intenta de nuevo.",
  "19": "Sin conexión, intenta de nuevo.",
  "99": "El servicio de pagos no está disponible. Intenta más tarde o usa otro método de pago.",
  "201": "Los datos del pago no son válidos. Intenta de nuevo o contacta a soporte.",
};

/** Catálogo — errorCode string del Bridge (cuerpo JSON o lógica equivalente). integracion_im30.md */
export const IM30_BRIDGE_STRING_UI: Record<string, string> = {
  EMV_START_FAILED:
    "No se pudo iniciar el cobro en la terminal. Comprueba que la TPV esté encendida, conectada y lista; luego intenta de nuevo.",
  EMV_BUSY: "La terminal está ocupada. Espera unos segundos e intenta de nuevo.",
  UNAUTHORIZED: "Error de seguridad con el servicio de terminal. Un operador debe revisar el token del EMVBridge.",
  SDK_NOT_AUTHENTICATED:
    "La sesión del servicio de pagos no está activa. Espera un momento e intenta de nuevo; si persiste, reinicia EMVBridge o vuelve a iniciar sesión.",
  LOGIN_FAILED: "Usuario o contraseña MiTec incorrectos. Un operador debe revisar las credenciales en la configuración.",
  INVALID_JSON: "Error interno al comunicarse con la terminal. Contacta a soporte técnico.",
  INVALID_BODY: "Error interno al comunicarse con la terminal. Contacta a soporte técnico.",
  NOT_FOUND: "Error interno: ruta del servicio de terminal incorrecta. Contacta a soporte técnico.",
  INTERNAL_ERROR: "Error interno en el servicio de la terminal. Intenta de nuevo; si persiste, revisa el log del EMVBridge.",
};

/** Códigos que devuelve el backend FastAPI cuando falla IM30 antes o después del Bridge. */
export const IM30_BACKEND_API_CODE_UI: Record<string, string> = {
  IM30_LOGIN:
    "No se pudo iniciar sesión con el servicio de pagos. Un operador debe revisar usuario y contraseña MiTec en la configuración.",
  IM30_CLIENT: "El servicio de terminal no está disponible. Reinicia la aplicación o contacta a soporte.",
  EMV_BUSY: IM30_BRIDGE_STRING_UI.EMV_BUSY,
  IM30_HTTP: "La terminal devolvió un error. Revisa el mensaje detallado o intenta de nuevo.",
  IM30_BAD_JSON: "Respuesta inválida del servicio de terminal. Intenta de nuevo o revisa EMVBridge.",
  CARD_ERROR: "No se pudo procesar el pago con tarjeta. Intenta de nuevo.",
  NO_CARD_TX: "La transacción con tarjeta no está preparada. Vuelve a elegir el método de pago.",
};

const NEST_KEYS = ["data", "error", "details", "detail", "result", "payload", "inner"] as const;

/** Orden: campos TPV / plataforma antes que `errorCode` genérico (p. ej. EMV_START_FAILED). */
const CODE_HINT_KEYS = [
  "pinPadErrorCode",
  "platformErrorCode",
  "codigoTerminal",
  "terminalCode",
  "codigoError",
  "platformCode",
  "code",
  "errorCode",
  "error_code",
] as const;

const DEFAULT_FALLBACK = "No se pudo completar el pago.";
const DEFAULT_API_FAIL = "Error de terminal";

function normalizeLookupKey(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.trunc(v);
    if (n >= 0 && n <= 99) return String(n).padStart(2, "0");
    return String(n);
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^Q\d+$/i.test(s)) return s.toUpperCase();
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, "0");
  if (/^\d+$/.test(s)) return s;
  return s.toUpperCase();
}

function collectRecordsDepthFirst(root: Record<string, unknown>, maxDepth: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();

  function walk(o: Record<string, unknown>, depth: number) {
    if (depth < 0 || seen.has(o)) return;
    seen.add(o);
    out.push(o);
    if (depth === 0) return;
    for (const k of NEST_KEYS) {
      const v = o[k];
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v as Record<string, unknown>, depth - 1);
    }
  }

  walk(root, maxDepth);
  return out;
}

function blobText(o: Record<string, unknown>): string {
  try {
    return JSON.stringify(o).toLowerCase();
  } catch {
    return "";
  }
}

/** `11` en MiTec = duplicado; en PIN pad = timeout. En flujo /sale priorizamos TPV salvo se detecte duplicado. */
function resolveAmbiguousEleven(records: Record<string, unknown>[]): "pin_timeout" | "mit_duplicate" {
  for (const r of records) {
    const mit = r.mitIm30;
    if (typeof mit === "string" && /duplicad|duplicate|duplicat/i.test(mit)) return "mit_duplicate";
  }
  for (const r of records) {
    if (/duplicad|duplicate|duplicat/.test(blobText(r))) return "mit_duplicate";
  }
  return "pin_timeout";
}

function lookupPinPad(key: string): string | undefined {
  if (IM30_PIN_PAD_UI[key]) return IM30_PIN_PAD_UI[key];
  if (/^\d$/.test(key)) return IM30_PIN_PAD_UI[key.padStart(2, "0")];
  return undefined;
}

function lookupMitec(key: string): string | undefined {
  return IM30_MITEC_PLATFORM_UI[key];
}

function lookupBridgeString(key: string): string | undefined {
  return IM30_BRIDGE_STRING_UI[key.toUpperCase()];
}

/**
 * Resuelve mensaje legible a partir del cuerpo JSON típico de /emv/sale o anidados en `details`.
 */
export function im30MessageFromPayload(d: Record<string, unknown>): string {
  const records = collectRecordsDepthFirst(d, 4);

  for (const r of records) {
    for (const k of CODE_HINT_KEYS) {
      const raw = r[k];
      const key = normalizeLookupKey(raw);
      if (!key) continue;
      if (key === "10") return IM30_PIN_PAD_UI["10"];
      if (key === "11") {
        return resolveAmbiguousEleven(records) === "mit_duplicate"
          ? IM30_MITEC_PLATFORM_UI["11"]
          : IM30_PIN_PAD_UI["11"];
      }
      const pin = lookupPinPad(key);
      if (pin) return pin;
      const mit = lookupMitec(key);
      if (mit) return mit;
      const bridge = lookupBridgeString(key);
      if (bridge) return bridge;
    }
  }

  for (const r of records) {
    const mit = r.mitIm30;
    if (typeof mit === "string" && mit.trim()) return mit.trim();
  }

  for (const r of records) {
    const resp = typeof r.respuesta === "string" ? r.respuesta.toLowerCase() : "";
    if (resp === "denied") return "Pago rechazado por el banco.";
    if (resp === "cancelled" || resp === "canceled") return "Operación cancelada.";
    if (resp === "timeout") return "Tiempo agotado. Puedes intentar de nuevo.";
  }

  const topEc = normalizeLookupKey(d.errorCode ?? d.error_code);
  if (topEc) {
    const bridgeOnly = lookupBridgeString(topEc);
    if (bridgeOnly) return bridgeOnly;
  }

  return DEFAULT_FALLBACK;
}

/**
 * Resuelve mensaje cuando `getStatus` o `cardSale` devuelven `success: false`.
 */
export function im30MessageFromApiFail(r: ApiFail): string {
  const det = r.details;
  if (det && typeof det === "object" && !Array.isArray(det)) {
    const d = det as Record<string, unknown>;
    const inner = d.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const m = im30MessageFromPayload(inner as Record<string, unknown>);
      if (m !== DEFAULT_FALLBACK) return m;
    }
    const m = im30MessageFromPayload(d);
    if (m !== DEFAULT_FALLBACK) return m;
  }

  const e = r.error;
  if (e && typeof e === "object") {
    const msg = im30MessageFromPayload(e as Record<string, unknown>);
    if (msg !== DEFAULT_FALLBACK) return msg;
  }

  if (typeof e === "string" && e.trim()) return e.trim();

  const code = typeof r.code === "string" ? r.code.trim() : "";
  if (code && IM30_BACKEND_API_CODE_UI[code]) return IM30_BACKEND_API_CODE_UI[code];

  return DEFAULT_API_FAIL;
}

/** Indica si el payload ya tiene información útil más allá del fallback genérico. */
export function im30PayloadHasKnownError(d: Record<string, unknown>): boolean {
  return im30MessageFromPayload(d) !== DEFAULT_FALLBACK;
}
