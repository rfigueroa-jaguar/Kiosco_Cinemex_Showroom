"""Monitoreo runtime de hardware — no reinicia procesos (PRD §13)."""

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from services.cpi_service import CPIService
    from services.im30_service import IM30Service
    from services.printer_service import PrinterService

_logger = logging.getLogger("kiosco.watchdog")


class HardwareWatchdog:
    def __init__(
        self,
        cpi: "CPIService",
        im30: "IM30Service",
        printer: "PrinterService",
        interval_sec: float = 3.0,
    ) -> None:
        self._cpi = cpi
        self._im30 = im30
        self._printer = printer
        self._interval = interval_sec
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def run_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self._cpi.refresh_watchdog_state()
                await self._im30.refresh_watchdog_state()
                await self._printer.refresh_watchdog_state()
            except Exception:
                _logger.exception("Watchdog tick failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._interval)
            except TimeoutError:
                pass

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self.run_loop())

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
