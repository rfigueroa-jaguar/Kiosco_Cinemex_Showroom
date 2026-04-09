"""Rutas REST — prefijos PRD §3.2."""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

from core.state import app_state
from services.cpi_service import CPIService
from services.im30_service import IM30Service
from services.mqtt_service import publish_transaction
from services.printer_service import PrinterService
from services.transaction_service import (
    build_new_state,
    delete_transaction,
    load_transaction,
    save_transaction,
    state_to_api_dict,
)

_logger = logging.getLogger("kiosco.api")

router = APIRouter(prefix="/api")


def get_cpi(request: Request) -> CPIService:
    s = request.app.state.services.get("cpi")
    if not s:
        raise HTTPException(503, "CPI no inicializado")
    return s


def get_im30(request: Request) -> IM30Service:
    s = request.app.state.services.get("im30")
    if not s:
        raise HTTPException(503, "IM30 no inicializado")
    return s


def get_printer(request: Request) -> PrinterService:
    s = request.app.state.services.get("printer")
    if not s:
        raise HTTPException(503, "Impresora no inicializada")
    return s


def _tx_file(request: Request) -> tuple[Any, str]:
    cfg = request.app.state.prod_config
    base = request.app.state.app_dir
    fn = cfg.get("transaction_state_filename", "transaction_state.json")
    return base, fn


@router.get("/status")
async def api_status(request: Request) -> dict[str, Any]:
    catalog_path = request.app.state.app_dir / "config" / "catalog.json"
    recovery = app_state.get("recovery")
    return {
        "success": True,
        "data": {
            "services": app_state["services"],
            "recovery": recovery,
            "catalog_path_exists": catalog_path.is_file(),
        },
    }


@router.get("/catalog")
async def api_catalog(request: Request) -> dict[str, Any]:
    import json
    from pathlib import Path

    p: Path = request.app.state.app_dir / "config" / "catalog.json"
    if not p.is_file():
        return {"success": False, "error": "Catálogo no encontrado", "code": "NO_CATALOG"}
    try:
        items = json.loads(p.read_text(encoding="utf-8"))
        return {"success": True, "data": {"items": items}}
    except Exception as e:
        return {"success": False, "error": str(e), "code": "CATALOG_READ"}


@router.get("/transaction")
async def get_transaction(request: Request) -> dict[str, Any]:
    base, fn = _tx_file(request)
    st = load_transaction(base, fn)
    if not st:
        return {"success": True, "data": None}
    return {"success": True, "data": state_to_api_dict(st)}


@router.post("/transaction/prepare")
async def transaction_prepare(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    base, fn = _tx_file(request)
    if load_transaction(base, fn):
        return {"success": False, "error": "Ya existe transacción activa", "code": "TX_EXISTS"}
    method = body.get("payment_method")
    amount = float(body.get("amount", 0))
    items = body.get("items") or []
    if method not in ("cash", "card"):
        return {"success": False, "error": "payment_method inválido", "code": "BAD_METHOD"}
    state = build_new_state(payment_method=method, amount=amount, items=items, step="waiting_payment")
    save_transaction(base, fn, state)
    return {"success": True, "data": state_to_api_dict(state)}


@router.post("/transaction/step")
async def transaction_step(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    base, fn = _tx_file(request)
    st = load_transaction(base, fn)
    if not st:
        return {"success": False, "error": "Sin transacción", "code": "NO_TX"}
    step = body.get("step")
    if step not in ("waiting_payment", "printing", "waiting_qr"):
        return {"success": False, "error": "step inválido", "code": "BAD_STEP"}
    updates: dict[str, Any] = {"step": step}
    if body.get("cpi_transaction_id"):
        updates["cpi_transaction_id"] = str(body["cpi_transaction_id"])
    if body.get("last_four") is not None:
        updates["last_four"] = str(body["last_four"]) if body["last_four"] else None
    if body.get("authorization") is not None:
        updates["authorization"] = str(body["authorization"]) if body["authorization"] else None
    if body.get("voucher") is not None:
        updates["voucher"] = str(body["voucher"]) if body["voucher"] else None
    st = st.model_copy(update=updates)
    save_transaction(base, fn, st)
    return {"success": True, "data": state_to_api_dict(st)}


@router.post("/transaction/confirm")
async def transaction_confirm(request: Request) -> dict[str, Any]:
    """Confirmar resumen: MQTT stub, borrar JSON, limpiar recovery."""
    base, fn = _tx_file(request)
    st = load_transaction(base, fn)
    if st:
        publish_transaction({"transaction_id": st.transaction_id, "items": [i.model_dump() for i in st.items]})
    delete_transaction(base, fn)
    app_state["recovery"] = None
    app_state["active_transaction"] = None
    return {"success": True, "data": {"ok": True}}


@router.post("/transaction/abandon")
async def transaction_abandon(request: Request) -> dict[str, Any]:
    base, fn = _tx_file(request)
    delete_transaction(base, fn)
    app_state["recovery"] = None
    app_state["active_transaction"] = None
    return {"success": True, "data": {"ok": True}}


@router.post("/scanner/scan-log")
async def scanner_scan_log(body: dict[str, Any]) -> dict[str, Any]:
    """Registra en el log del servidor el texto crudo del lector (modo teclado / HID)."""
    raw = body.get("raw")
    if not isinstance(raw, str):
        raw = ""
    max_len = 800
    snippet = raw if len(raw) <= max_len else f"{raw[:max_len]}…"
    expected = body.get("expected_transaction_id")
    extracted = body.get("extracted_transaction_id")
    ok = body.get("ok")
    codes = body.get("codepoints_head")
    _logger.info(
        "Lector QR/scan: válido=%s longitud=%s esperado=%s extraído=%s codepoints_inicio=%s raw_repr=%s",
        ok,
        len(raw),
        expected,
        extracted,
        codes,
        repr(snippet),
    )
    return {"success": True, "data": {"logged": True}}


@router.post("/payment/cash/initiate")
async def cash_initiate(
    request: Request,
    body: dict[str, Any],
    cpi: Annotated[CPIService, Depends(get_cpi)],
) -> dict[str, Any]:
    if not cpi.ssl_configured:
        return {"success": False, "error": "CPI no disponible (SSL / Root.cer)", "code": "CPI_SSL"}
    base, fn = _tx_file(request)
    st = load_transaction(base, fn)
    if not st or st.payment_method != "cash":
        return {"success": False, "error": "Transacción efectivo no preparada", "code": "NO_CASH_TX"}

    # Paso 1 del flujo: verificar estado del reciclador antes de iniciar
    readiness = await cpi.ensure_ready_for_transaction()
    if not readiness.get("ready"):
        _logger.warning(
            "CPI no listo para transacción — code=%s status=%s",
            readiness.get("code"),
            readiness.get("status", "?"),
        )
        return {
            "success": False,
            "error": readiness.get("message", "Reciclador no disponible"),
            "code": readiness.get("code", "CPI_NOT_READY"),
            "retry": readiness.get("retry", False),
        }

    cents = int(round(float(st.amount) * 100))
    res = await cpi.start_transaction_cents(cents)
    if res.get("error"):
        return {
            "success": False,
            "error": res.get("body", "Error CPI"),
            "code": "CPI_START",
            "http": res.get("http"),
        }

    # TransactionDTO usa 'transactionId' (camelCase). Fallbacks por si cambia la versión.
    cpi_id = str(res.get("transactionId") or res.get("id") or res.get("Id") or "")
    if not cpi_id:
        _logger.error("CPI respondió sin transactionId: %s", str(res)[:400])
        return {"success": False, "error": "CPI sin id de transacción", "code": "CPI_NO_ID"}

    # TransactionDTO usa 'status' (camelCase).
    tx_status = str(res.get("status") or res.get("transactionStatus") or res.get("TransactionStatus") or "")

    if tx_status != "InProgress":
        _logger.warning(
            "CPI transacción creada id=%s pero status=%s (esperado InProgress) — cancelando",
            cpi_id,
            tx_status,
        )
        try:
            await cpi.cancel_transaction(cpi_id)
        except Exception:
            _logger.exception("No se pudo cancelar transacción CPI id=%s tras estado inesperado", cpi_id)

        # Mensajes diferenciados según el enum TransactionStatus del schema
        _NO_CHANGE = {"NotStartedInsufficientChange", "InsufficientChange"}
        _BUSY       = {"NotStartedBusy"}
        _PROHIBITED = {"NotStartedProhibited", "NotStartedNotSupported"}
        _DEVICES    = {"DevicesNotReady", "DeviceError", "ServiceStopped"}
        _CURRENCY   = {"WrongCurrencyError", "NotStartedInsufficientAllowedCurrency"}

        if tx_status in _NO_CHANGE:
            return {
                "success": False,
                "error": (
                    "El reciclador no tiene suficiente cambio disponible. "
                    "Avisa a un operador para que reabastezca el equipo."
                ),
                "code": "CPI_INSUFFICIENT_CHANGE",
                "retry": False,
            }
        if tx_status in _BUSY:
            return {
                "success": False,
                "error": "El reciclador está ocupado con otra transacción. Espera un momento e intenta de nuevo.",
                "code": "CPI_BUSY",
                "retry": True,
            }
        if tx_status in _PROHIBITED:
            return {
                "success": False,
                "error": "Este tipo de transacción no está permitido en este reciclador. Contacta a soporte.",
                "code": "CPI_PROHIBITED",
                "retry": False,
            }
        if tx_status in _DEVICES:
            err_msg = str(res.get("errorMessage") or "")
            return {
                "success": False,
                "error": f"Error en el dispositivo de pago: {err_msg}" if err_msg else "Error en el dispositivo de pago.",
                "code": "CPI_DEVICE_ERROR",
                "retry": False,
            }
        if tx_status in _CURRENCY:
            return {
                "success": False,
                "error": "Moneda no permitida o cambio insuficiente para esta divisa.",
                "code": "CPI_CURRENCY_ERROR",
                "retry": False,
            }
        # Fallback para cualquier otro estado no-InProgress
        return {
            "success": False,
            "error": f"La transacción no pudo iniciarse ({tx_status}). Intenta de nuevo.",
            "code": "CPI_TX_NOT_STARTED",
            "retry": True,
        }

    st.cpi_transaction_id = cpi_id
    save_transaction(base, fn, st)
    _logger.info("CPI transacción iniciada — transactionId=%s monto=%s centavos", cpi_id, cents)
    return {"success": True, "data": {"cpi_transaction_id": cpi_id, "cpi": res}}


@router.get("/payment/cash/poll/{cpi_tx_id}")
async def cash_poll(
    cpi_tx_id: str,
    cpi: Annotated[CPIService, Depends(get_cpi)],
) -> dict[str, Any]:
    if not cpi.ssl_configured:
        return {"success": False, "error": "CPI no disponible", "code": "CPI_SSL"}
    res = await cpi.get_transaction(cpi_tx_id)
    if res.get("error"):
        return {
            "success": False,
            "error": res.get("body", "Error CPI"),
            "code": "CPI_POLL",
            "http": res.get("http"),
        }
    return {"success": True, "data": res}


@router.post("/payment/cash/cancel/{cpi_tx_id}")
async def cash_cancel(
    cpi_tx_id: str,
    cpi: Annotated[CPIService, Depends(get_cpi)],
) -> dict[str, Any]:
    if not cpi.ssl_configured:
        return {"success": False, "error": "CPI no disponible", "code": "CPI_SSL"}
    res = await cpi.cancel_transaction(cpi_tx_id)
    return {"success": True, "data": res}


@router.post("/payment/cash/reconciliation")
async def cash_reconciliation(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """
    Tras CompletedSuccess: verifica que (totalAccepted - totalDispensed) coincida con el monto esperado.
    Si no, registra ERROR en log con snapshot (alarma operativa); el flujo de la UI sigue igual.
    """
    base, fn = _tx_file(request)
    st = load_transaction(base, fn)
    if not st or st.payment_method != "cash":
        return {"success": False, "error": "Transacción efectivo no activa", "code": "NO_CASH_TX"}

    kiosk_tx_id = str(body.get("transaction_id") or st.transaction_id)
    if kiosk_tx_id != st.transaction_id:
        return {"success": False, "error": "transaction_id no coincide con la transacción activa", "code": "TX_MISMATCH"}

    cpi_id = str(body.get("cpi_transaction_id") or st.cpi_transaction_id or "")
    if not cpi_id:
        return {"success": False, "error": "Sin cpi_transaction_id", "code": "NO_CPI_ID"}

    ta = int(body.get("total_accepted", 0))
    td = int(body.get("total_dispensed", 0))
    expected = int(body.get("expected_cents", 0))
    tv = body.get("transaction_value")
    net = ta - td
    coherent = abs(net - expected) <= 1

    if not coherent:
        snapshot = {
            "kiosk_transaction_id": kiosk_tx_id,
            "cpi_transaction_id": cpi_id,
            "totalAccepted": ta,
            "totalDispensed": td,
            "net_cents": net,
            "expected_cents": expected,
            "transactionValue": tv,
            "kiosk_amount_mx": st.amount,
            "status": body.get("status"),
        }
        _logger.error(
            "CPI reconciliación incoherente (neto retenido vs monto esperado): %s",
            json.dumps(snapshot, default=str),
        )

    return {
        "success": True,
        "data": {"coherent": coherent, "net_cents": net, "expected_cents": expected},
    }


@router.post("/payment/card/sale")
async def card_sale(
    request: Request,
    body: dict[str, Any],
    im30: Annotated[IM30Service, Depends(get_im30)],
) -> dict[str, Any]:
    base, fn = _tx_file(request)
    st = load_transaction(base, fn)
    if not st or st.payment_method != "card":
        return {"success": False, "error": "Transacción tarjeta no preparada", "code": "NO_CARD_TX"}
    referencia = str(body.get("referencia") or st.transaction_id)
    cfg = request.app.state.prod_config
    monto_terminal = float(cfg.get("card_terminal_charge_amount_mx", 0.10))
    _logger.info(
        "IM30 /sale referencia=%s monto_terminal=%s MXN (total carrito en estado=%s)",
        referencia,
        monto_terminal,
        st.amount,
    )
    out = await im30.sale(referencia, monto_terminal)
    if not out.get("success"):
        err_payload = out.get("error", "")
        # Si el payload de error es un dict (body del Bridge), no convertir con str()
        # porque produce repr de Python no parseable. Se deja en details; error queda
        # como string vacío para que im30MessageFromApiFail use el catálogo de código.
        err_str = err_payload if isinstance(err_payload, str) else ""
        _logger.warning(
            "IM30 venta fallida — code=%s | %s",
            out.get("code"),
            str(out)[:400],
        )
        return {
            "success": False,
            "error": err_str,
            "code": str(out.get("code", "CARD_ERROR")),
            "details": out,
        }
    _logger.info(
        "IM30 venta Bridge completada — referencia=%s respuesta=%s",
        referencia,
        (out.get("data") or {}).get("respuesta", "?"),
    )
    return {"success": True, "data": out.get("data")}


@router.post("/printer/print")
async def printer_print(
    request: Request,
    body: dict[str, Any],
    printer: Annotated[PrinterService, Depends(get_printer)],
) -> dict[str, Any]:
    base, fn = _tx_file(request)
    st = load_transaction(base, fn)
    tx_id = str(body.get("transaction_id") or (st.transaction_id if st else ""))
    raw_items = body.get("items") or (st.items if st else [])
    total = float(body.get("total", st.amount if st else 0))
    method = str(body.get("payment_method", st.payment_method if st else "cash"))
    last_four = body.get("last_four")
    if last_four is None and st:
        last_four = st.last_four

    authorization = body.get("authorization") or body.get("autorizacion")
    if authorization is None and st:
        authorization = st.authorization
    voucher = body.get("voucher")
    if voucher is None and st:
        voucher = st.voucher

    serialized_items: list[dict[str, Any]] = []
    for i in raw_items:
        if isinstance(i, dict):
            serialized_items.append(i)
        else:
            serialized_items.append(i.model_dump())

    payload: dict[str, Any] = {
        "transaction_id": tx_id,
        "items": serialized_items,
        "total": total,
        "payment_method": method,
        "last_four": last_four,
    }
    if authorization:
        payload["authorization"] = str(authorization)
    if voucher:
        payload["voucher"] = str(voucher)
    try:
        _logger.info("Imprimiendo ticket — transaction_id=%s (el QR codifica este mismo UUID en texto plano)", tx_id)
        printer.print_ticket(payload)
        return {"success": True, "data": {"printed": True}}
    except Exception as e:
        _logger.exception("Fallo de impresión")
        return {"success": False, "error": str(e), "code": "PRINT_ERROR", "data": {"printed": False}}


@router.post("/mqtt/publish-stub")
async def mqtt_stub(body: dict[str, Any]) -> dict[str, Any]:
    publish_transaction(body)
    return {"success": True, "data": {"ok": True}}
