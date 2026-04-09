"""Rutas REST — prefijos PRD §3.2."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

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
    cents = int(round(float(st.amount) * 100))
    res = await cpi.start_transaction_cents(cents)
    if res.get("error"):
        return {
            "success": False,
            "error": res.get("body", "Error CPI"),
            "code": "CPI_START",
            "http": res.get("http"),
        }
    cpi_id = str(res.get("id", ""))
    if not cpi_id:
        return {"success": False, "error": "CPI sin id de transacción", "code": "CPI_NO_ID"}
    st.cpi_transaction_id = cpi_id
    save_transaction(base, fn, st)
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
    monto = float(body.get("monto", st.amount))
    out = await im30.sale(referencia, monto)
    if not out.get("success"):
        return {
            "success": False,
            "error": str(out.get("error", "Error")),
            "code": str(out.get("code", "CARD_ERROR")),
            "details": out,
        }
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

    serialized_items: list[dict[str, Any]] = []
    for i in raw_items:
        if isinstance(i, dict):
            serialized_items.append(i)
        else:
            serialized_items.append(i.model_dump())

    payload = {
        "transaction_id": tx_id,
        "items": serialized_items,
        "total": total,
        "payment_method": method,
        "last_four": last_four,
    }
    try:
        printer.print_ticket(payload)
        return {"success": True, "data": {"printed": True}}
    except Exception as e:
        _logger.exception("Fallo de impresión")
        return {"success": False, "error": str(e), "code": "PRINT_ERROR", "data": {"printed": False}}


@router.post("/mqtt/publish-stub")
async def mqtt_stub(body: dict[str, Any]) -> dict[str, Any]:
    publish_transaction(body)
    return {"success": True, "data": {"ok": True}}
