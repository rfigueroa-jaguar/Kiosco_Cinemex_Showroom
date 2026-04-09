"""Entrada FastAPI — kiosco Cinemex."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_routes import router as api_router
from config_loader import load_prod_config
from core.error_handler import install_global_excepthook
from core.state import app_state
from core.watchdog import HardwareWatchdog
from logging_setup import setup_logging
from services.cpi_service import CPIService
from services.im30_service import IM30Service
from services.mqtt_service import publish_fatal_error
from services.printer_service import PrinterService
from services.transaction_service import (
    delete_transaction,
    load_transaction,
    state_to_api_dict,
)
from settings import APP_DIR, load_settings

load_dotenv(APP_DIR / ".env")

_logger = logging.getLogger("kiosco.main")


async def _run_recovery(app_dir: Path, prod: dict, cpi: CPIService) -> None:
    fn = prod.get("transaction_state_filename", "transaction_state.json")
    st = load_transaction(app_dir, fn)
    if not st:
        app_state["recovery"] = None
        return

    app_state["active_transaction"] = state_to_api_dict(st)

    if st.step == "waiting_payment":
        _logger.warning("Recuperación: waiting_payment — cancelando transacciones CPI abiertas")
        if cpi.ssl_configured and cpi._client:
            try:
                txs = await cpi.list_current_transactions()
                for t in txs:
                    tid = t.get("id") or t.get("Id")
                    if tid:
                        await cpi.cancel_transaction(str(tid))
            except Exception:
                _logger.exception("Recuperación CPI cancel falló")
        delete_transaction(app_dir, fn)
        app_state["recovery"] = {"action": "reset_to_welcome", "reason": "aborted_payment_recovery"}
        app_state["active_transaction"] = None
        return

    if st.step == "printing":
        app_state["recovery"] = {
            "action": "resume_print",
            "transaction": state_to_api_dict(st),
        }
        return

    if st.step == "waiting_qr":
        app_state["recovery"] = {
            "action": "go_qr",
            "transaction": state_to_api_dict(st),
        }
        return


@asynccontextmanager
async def lifespan(app: FastAPI):
    app_dir = APP_DIR
    log_dir = app_dir / "logs"
    setup_logging(log_dir)
    install_global_excepthook(log_dir, on_fatal=publish_fatal_error)

    prod_path = app_dir / "config" / "prod.yaml"
    prod = load_prod_config(prod_path)
    settings = load_settings()

    subject_hint = str(prod.get("cpi_root_cert_subject_hint", "CPI"))

    cpi = CPIService(settings, subject_hint)
    im30 = IM30Service(settings)
    logo = app_dir / "config" / "logo.png"
    printer_display_name = settings.thermal_printer_name.strip() or str(
        prod.get("printer_name", "CUSTOM MODUS3 X")
    )
    ticket_width_mm = float(prod.get("ticket_width_mm", 76))
    printer = PrinterService(
        printer_display_name,
        logo_path=logo if logo.is_file() else None,
        ticket_width_mm=ticket_width_mm,
    )

    app.state.app_dir = app_dir
    app.state.prod_config = prod
    app.state.settings = settings
    app.state.services = {"cpi": cpi, "im30": im30, "printer": printer}

    await cpi.startup_check()
    await im30.startup_check()
    await printer.startup_check()

    await _run_recovery(app_dir, prod, cpi)

    wd_interval = float(prod.get("watchdog_interval_seconds", 3))
    watchdog = HardwareWatchdog(cpi, im30, printer, interval_sec=wd_interval)
    app.state.watchdog = watchdog
    watchdog.start()

    _logger.info("FastAPI listo en %s", app_dir)
    yield

    await watchdog.stop()
    await cpi.shutdown()
    await im30.shutdown()


app = FastAPI(title="Kiosco Cinemex API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(api_router)
