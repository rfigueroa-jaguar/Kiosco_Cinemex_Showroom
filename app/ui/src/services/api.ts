const API_BASE = "";

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFail = { success: false; error: string; code?: string; [k: string]: unknown };
export type ApiResult<T> = ApiSuccess<T> | ApiFail;

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  const j = await res.json().catch(() => ({}));
  return j as ApiResult<T>;
}

export type ServiceSnapshot = { available: boolean; status: string; message?: string };

export async function getStatus(): Promise<ApiResult<{
  services: Record<string, ServiceSnapshot>;
  recovery: unknown;
}>> {
  const r = await fetch(`${API_BASE}/api/status`);
  return parse(r);
}

export async function getCatalog(): Promise<ApiResult<{ items: CatalogProduct[] }>> {
  const r = await fetch(`${API_BASE}/api/catalog`);
  return parse(r);
}

export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
}

export interface CartLine {
  id: string;
  name: string;
  price: number;
  qty: number;
}

export interface TransactionPayload {
  transaction_id: string;
  status: string;
  payment_method: "cash" | "card";
  amount: number;
  step: string;
  items: CartLine[];
  timestamp: string;
  cpi_transaction_id?: string | null;
  last_four?: string | null;
  authorization?: string | null;
  voucher?: string | null;
}

export async function getTransaction(): Promise<ApiResult<TransactionPayload | null>> {
  const r = await fetch(`${API_BASE}/api/transaction`);
  return parse(r);
}

export async function prepareTransaction(body: {
  payment_method: "cash" | "card";
  amount: number;
  items: CartLine[];
}): Promise<ApiResult<TransactionPayload>> {
  const r = await fetch(`${API_BASE}/api/transaction/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse(r);
}

export async function setTransactionStep(body: Record<string, unknown>): Promise<ApiResult<TransactionPayload>> {
  const r = await fetch(`${API_BASE}/api/transaction/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse(r);
}

export async function confirmTransaction(): Promise<ApiResult<{ ok: boolean }>> {
  const r = await fetch(`${API_BASE}/api/transaction/confirm`, { method: "POST" });
  return parse(r);
}

export async function abandonTransaction(): Promise<ApiResult<{ ok: boolean }>> {
  const r = await fetch(`${API_BASE}/api/transaction/abandon`, { method: "POST" });
  return parse(r);
}

/** Envía al backend una línea de log con lo leído por el escáner (no bloquea la UI). */
export function logScanAttempt(body: {
  raw: string;
  expected_transaction_id: string;
  extracted_transaction_id: string | null;
  ok: boolean;
  codepoints_head?: number[];
}): void {
  void fetch(`${API_BASE}/api/scanner/scan-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export async function cashInitiate(): Promise<ApiResult<{ cpi_transaction_id: string }>> {
  const r = await fetch(`${API_BASE}/api/payment/cash/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return parse(r);
}

export async function cashPoll(cpiTxId: string): Promise<ApiResult<Record<string, unknown>>> {
  const r = await fetch(`${API_BASE}/api/payment/cash/poll/${encodeURIComponent(cpiTxId)}`);
  return parse(r);
}

export async function cashCancel(cpiTxId: string): Promise<ApiResult<unknown>> {
  const r = await fetch(`${API_BASE}/api/payment/cash/cancel/${encodeURIComponent(cpiTxId)}`, {
    method: "POST",
  });
  return parse(r);
}

export async function cashReconciliation(body: {
  transaction_id: string;
  cpi_transaction_id: string;
  total_accepted: number;
  total_dispensed: number;
  expected_cents: number;
  transaction_value?: number;
  status?: string;
}): Promise<ApiResult<{ coherent: boolean; net_cents: number; expected_cents: number }>> {
  const r = await fetch(`${API_BASE}/api/payment/cash/reconciliation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse(r);
}

export async function cardSale(body: { referencia?: string; monto?: number }): Promise<ApiResult<Record<string, unknown>>> {
  const r = await fetch(`${API_BASE}/api/payment/card/sale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse(r);
}

export async function printTicket(body: Record<string, unknown>): Promise<ApiResult<{ printed: boolean }>> {
  const r = await fetch(`${API_BASE}/api/printer/print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse(r);
}
